// Static architecture-boundary rules (dependency-free so it runs before `pnpm install`).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep, dirname, resolve } from 'node:path';

/** Allowed PRODUCTION workspace dependencies. Anything else fails. */
export const ALLOWED_PROD = {
  config: [],
  contracts: [],
  i18n: [],
  db: ['contracts'],
  auth: ['contracts', 'db'],
  core: ['auth', 'contracts', 'db', 'i18n'],
  api: ['auth', 'contracts', 'core', 'i18n'],
  testing: ['auth'],
  web: ['api', 'auth', 'config', 'contracts', 'core', 'db', 'i18n'],
};

/** Third-party packages that may only be imported from specific places (relative path prefixes). */
export const RESTRICTED_IMPORTS = [
  { name: /^better-auth(\/|$)/, allow: ['packages/auth/src/better-auth/', 'packages/auth/test/'], why: 'Better Auth is an implementation detail behind AuthPort' },
  { name: /^@node-rs\/argon2$/, allow: ['packages/auth/src/better-auth/', 'packages/auth/test/'], why: 'password hashing lives with the auth provider' },
  { name: /^(drizzle-orm|pg)(\/|$)/, allow: ['packages/db/', 'packages/core/', 'packages/auth/test/'], why: 'database access is confined to db/core' },
  { name: /^(next|react|react-dom)(\/|$)/, allow: ['apps/web/'], why: 'UI frameworks must not leak into domain/infrastructure packages' },
  { name: /^(hono|@hono\/)/, allow: ['packages/api/', 'apps/web/src/app/', 'packages/testing/'], why: 'HTTP framework confined to the API layer' },
  { name: /^@sentry\//, allow: ['apps/web/', 'scripts/'], why: 'error reporting is wired at the app edge' },
];

/** UI code must not reach infrastructure. Applies to *.tsx and apps/web/src/components/**. */
export const UI_FORBIDDEN = [/^@bnlinkvault\/(db|core)(\/|$)/, /^@bnlinkvault\/auth\/better-auth$/, /^better-auth/, /^pg$/, /^drizzle-orm/];

const IMPORT_RE = /(?:^|[^\w$.])(?:import|export)\s+(?:type\s+)?(?:[^'"`;]*?\sfrom\s+)?['"]([^'"]+)['"]|(?:require|import)\(\s*['"]([^'"]+)['"]\s*\)/g;

export function extractImports(source) {
  const found = [];
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  let m;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(withoutComments)) !== null) found.push(m[1] ?? m[2]);
  return found;
}

function* walk(dir, skip = new Set(['node_modules', '.next', '.turbo', 'coverage', 'dist'])) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p, skip);
    else yield p;
  }
}

const norm = (p) => p.split(sep).join('/');
const shortName = (pkg) => pkg.replace(/^@bnlinkvault\//, '');

export function loadWorkspace(root) {
  const units = [];
  for (const group of ['apps', 'packages']) {
    const base = join(root, group);
    if (!existsSync(base)) continue;
    for (const d of readdirSync(base)) {
      const pj = join(base, d, 'package.json');
      if (!existsSync(pj)) continue;
      const json = JSON.parse(readFileSync(pj, 'utf8'));
      units.push({ dir: join(base, d), rel: `${group}/${d}`, name: json.name, short: shortName(json.name), json });
    }
  }
  return units;
}

const internalDeps = (json, fields) =>
  fields.flatMap((f) => Object.keys(json[f] ?? {})).filter((n) => n.startsWith('@bnlinkvault/')).map(shortName);

export function findCycles(graph) {
  const cycles = [];
  const state = new Map();
  const stack = [];
  const visit = (n) => {
    state.set(n, 1);
    stack.push(n);
    for (const d of graph.get(n) ?? []) {
      if (state.get(d) === 1) cycles.push([...stack.slice(stack.indexOf(d)), d].join(' -> '));
      else if (!state.has(d)) visit(d);
    }
    stack.pop();
    state.set(n, 2);
  };
  for (const n of graph.keys()) if (!state.has(n)) visit(n);
  return cycles;
}

export function checkBoundaries(root) {
  const problems = [];
  const units = loadWorkspace(root);
  const byShort = new Map(units.map((u) => [u.short, u]));

  // 1. Manifest-level rules
  const graph = new Map();
  for (const u of units) {
    const prod = internalDeps(u.json, ['dependencies']);
    const all = internalDeps(u.json, ['dependencies', 'devDependencies']);
    graph.set(u.short, all);
    const allowed = ALLOWED_PROD[u.short];
    if (!allowed) problems.push(`${u.rel}: package is not listed in the boundary matrix (add it deliberately)`);
    else for (const d of prod) if (!allowed.includes(d)) problems.push(`${u.rel}: forbidden production dependency on @bnlinkvault/${d}`);
    for (const d of all) if (d === 'web') problems.push(`${u.rel}: nothing may depend on the web app`);
  }
  for (const c of findCycles(graph)) problems.push(`dependency cycle: ${c}`);

  // 2. Source-level rules
  for (const u of units) {
    const declared = new Set(internalDeps(u.json, ['dependencies', 'devDependencies']));
    const external = new Set(Object.keys({ ...u.json.dependencies, ...u.json.devDependencies }));
    for (const file of walk(u.dir)) {
      if (!/\.(ts|tsx|mts|js|mjs)$/.test(file) || file.endsWith('.d.ts')) continue;
      const rel = norm(relative(root, file));
      const isTest = /\/(test|tests|__tests__)\//.test(rel) || /\.test\.[tj]sx?$/.test(rel);
      const text = readFileSync(file, 'utf8');
      for (const spec of extractImports(text)) {
        // internal packages
        if (spec.startsWith('@bnlinkvault/')) {
          const pkg = shortName(spec.split('/').slice(0, 2).join('/'));
          if (pkg !== u.short && !declared.has(pkg)) problems.push(`${rel}: imports @bnlinkvault/${pkg} without declaring it in package.json`);
          if (/@bnlinkvault\/[^/]+\/src\//.test(spec)) problems.push(`${rel}: deep import into another package's src (${spec})`);
          if (isTest) { /* tests may use any declared dependency */ }
          else if (pkg !== u.short && !byShort.has(pkg)) problems.push(`${rel}: unknown workspace package ${spec}`);
        }
        // relative escapes
        if (spec.startsWith('.')) {
          const target = resolve(dirname(file), spec);
          if (!norm(target).startsWith(norm(u.dir)) && !isTest) problems.push(`${rel}: relative import escapes the package (${spec})`);
        }
        // restricted third-party packages
        for (const r of RESTRICTED_IMPORTS) {
          if (r.name.test(spec) && !r.allow.some((a) => rel.startsWith(a))) problems.push(`${rel}: import of "${spec}" not allowed here (${r.why})`);
        }
        // UI layer
        const isUi = rel.startsWith('apps/web/') && (rel.endsWith('.tsx') || rel.includes('/src/components/'));
        if (isUi && UI_FORBIDDEN.some((re) => re.test(spec))) problems.push(`${rel}: UI code must not import infrastructure ("${spec}")`);
        // undeclared external dependency (production source only)
        if (!isTest && !spec.startsWith('.') && !spec.startsWith('node:') && !spec.startsWith('@bnlinkvault/') && !spec.startsWith('@/')) {
          const pkgName = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
          if (!external.has(pkgName) && !['next', 'react'].includes(pkgName) && !/^(server-only)$/.test(pkgName)) {
            problems.push(`${rel}: imports "${pkgName}" which is not declared in ${u.rel}/package.json`);
          }
        }
      }
      // authoritative state must never live in browser storage
      if (rel.startsWith('apps/web/src/') && !isTest && /\b(localStorage|sessionStorage)\b/.test(text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''))) {
        problems.push(`${rel}: localStorage/sessionStorage is forbidden (no authoritative state in the browser)`);
      }
    }
  }
  return problems;
}
