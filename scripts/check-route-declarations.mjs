#!/usr/bin/env node
// Static guard: every API route must be added through declareRoute() with a complete RouteMeta.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const apiSrc = join(root, 'packages/api/src');
const problems = [];

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const files = [];
(function walk(d) {
  for (const n of readdirSync(d, { withFileTypes: true })) {
    if (n.isDirectory()) walk(join(d, n.name));
    else if (n.name.endsWith('.ts')) files.push(join(d, n.name));
  }
})(apiSrc);

const usedActions = new Set();
const ALLOWED_RAW = new Set(['declare.ts', 'app.ts']); // the only files allowed to touch the router directly

for (const f of files) {
  const base = f.split('/').pop();
  const text = strip(readFileSync(f, 'utf8'));
  if (!ALLOWED_RAW.has(base) && /\b(?:app|kit\.app|router)\s*\.(?:openapi|get|post|put|patch|delete|all|route|on)\s*\(/.test(text)) {
    problems.push(`${f.replace(root + '/', '')}: registers a route without declareRoute()`);
  }
  let idx = 0;
  while ((idx = text.indexOf('declareRoute(', idx)) !== -1) {
    const open = text.indexOf('{', idx);
    let depth = 0, end = open;
    for (; end < text.length; end++) {
      if (text[end] === '{') depth++;
      else if (text[end] === '}' && --depth === 0) break;
    }
    const meta = text.slice(open, end + 1);
    const where = `${f.replace(root + '/', '')} (${/id:\s*'([^']+)'/.exec(meta)?.[1] ?? 'unknown id'})`;
    if (/auth:\s*'public'/.test(meta)) {
      if (!/reason:\s*'/.test(meta)) problems.push(`${where}: public route without reason`);
    } else if (/auth:\s*'session'/.test(meta)) {
      const action = /action:\s*'([a-z_]+:[a-z_]+)'/.exec(meta)?.[1];
      if (!action) problems.push(`${where}: missing action`);
      else usedActions.add(action);
      if (!/resource:\s*'[a-z_]+'/.test(meta)) problems.push(`${where}: missing resource`);
      if (!/tenant:\s*(true|false)/.test(meta)) problems.push(`${where}: missing tenant flag`);
    } else problems.push(`${where}: missing auth declaration`);
    idx = end;
  }
}

const domain = readFileSync(join(root, 'packages/contracts/src/domain.ts'), 'utf8');
const block = /export const ACTIONS = \[([\s\S]*?)\] as const;/.exec(domain)?.[1] ?? '';
const declaredActions = [...block.matchAll(/'([a-z_]+:[a-z_]+)'/g)].map((m) => m[1]);
if (declaredActions.length === 0) problems.push('could not read ACTIONS from contracts/domain.ts');
for (const a of declaredActions) if (!usedActions.has(a)) problems.push(`action "${a}" exists in the permission matrix but no route declares it`);
for (const a of usedActions) if (!declaredActions.includes(a)) problems.push(`route uses unknown action "${a}"`);

if (problems.length > 0) {
  process.stderr.write('Route declaration problems:\n');
  for (const p of problems) process.stderr.write(`  - ${p}\n`);
  process.exit(1);
}
process.stdout.write(`route declarations: OK (${usedActions.size} actions covered)\n`);
