import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(REPO, p), 'utf8');

test('peer-dependency validation stays strict (no policy weakening)', () => {
  const npmrc = read('.npmrc');
  assert.match(npmrc, /^strict-peer-dependencies=true$/m);
  assert.match(npmrc, /^auto-install-peers=false$/m);
  assert.doesNotMatch(npmrc, /legacy-peer-deps|resolve-peers-from-workspace-root=false/);
});

test('no workflow or script bypasses peer checks (--no-strict-peer-dependencies, --force, --legacy-peer-deps)', () => {
  const files = [...readdirSync(join(REPO, '.github/workflows')).map((f) => `.github/workflows/${f}`), 'package.json'];
  for (const f of files) assert.doesNotMatch(read(f), /--no-strict-peer-dependencies|--legacy-peer-deps|pnpm (install|add|i)[^\n]*--force|strict-peer-dependencies=false/, f);
});

test('apps/web satisfies the required webpack peer of @sentry/webpack-plugin: declared once, from an exact catalog pin', () => {
  const web = JSON.parse(read('apps/web/package.json'));
  assert.equal(web.dependencies['@sentry/nextjs'], 'catalog:');
  assert.equal(web.devDependencies.webpack, 'catalog:');
  const yaml = read('pnpm-workspace.yaml');
  const m = /^\s*webpack:\s*(\d+\.\d+\.\d+)\s*$/m.exec(yaml);
  assert.ok(m, 'exact webpack version pinned in the catalog');
  assert.ok(Number(m[1].split('.')[0]) >= 5, 'webpack >= 5 (peer range is >=4.40.0)');
  // exactly one declaration point per package: no other manifest may declare webpack
  for (const group of ['apps', 'packages']) {
    for (const d of readdirSync(join(REPO, group))) {
      let pj;
      try { pj = JSON.parse(read(`${group}/${d}/package.json`)); } catch { continue; }
      const declares = Boolean(pj.dependencies?.webpack ?? pj.devDependencies?.webpack);
      assert.equal(declares, `${group}/${d}` === 'apps/web', `${group}/${d} webpack declaration`);
    }
  }
  assert.doesNotMatch(read('package.json'), /"webpack"/);
});

test('every catalog dependency is an exact pin and every "catalog:" reference resolves to a catalog entry', () => {
  const yaml = read('pnpm-workspace.yaml');
  const block = /^catalog:\n([\s\S]*?)^\S/m.exec(yaml)?.[1] ?? '';
  const entries = new Map([...block.matchAll(/^\s+"?([^":\s]+(?:\/[^":\s]+)?)"?:\s*([^\s#]+)/gm)].map((m) => [m[1], m[2]]));
  assert.ok(entries.size > 20);
  for (const [name, v] of entries) assert.match(v, /^\d+\.\d+\.\d+(-UNRESOLVED)?$/, `${name}@${v} must be exact`);
  const walk = (dir) => readdirSync(join(REPO, dir)).map((d) => `${dir}/${d}/package.json`);
  for (const f of ['package.json', ...walk('apps'), ...walk('packages')]) {
    let pj;
    try { pj = JSON.parse(read(f)); } catch { continue; }
    for (const field of ['dependencies', 'devDependencies']) {
      for (const [name, spec] of Object.entries(pj[field] ?? {})) {
        if (spec === 'catalog:') assert.ok(entries.has(name), `${f}: ${name} uses catalog: but is not in the catalog`);
      }
    }
  }
});
