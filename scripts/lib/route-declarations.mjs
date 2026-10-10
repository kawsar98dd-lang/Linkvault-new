// Static guard (dependency-free): every API route must be registered as
//   kit.app.openapi(createRoute({ ..., middleware: routeGuard(kit, { ...complete RouteMeta... }) }), handler)
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Returns the index of the bracket that closes the one at `open`, honouring string literals. */
export function matchBracket(text, open) {
  const pairs = { '(': ')', '{': '}', '[': ']' };
  const stack = [];
  let str = null;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (str) {
      if (ch === '\\') i++;
      else if (ch === str) str = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') str = ch;
    else if (pairs[ch]) stack.push(pairs[ch]);
    else if (ch === stack[stack.length - 1]) {
      stack.pop();
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

function listTs(dir) {
  const out = [];
  for (const n of readdirSync(dir, { withFileTypes: true })) {
    if (n.isDirectory()) out.push(...listTs(join(dir, n.name)));
    else if (n.name.endsWith('.ts')) out.push(join(dir, n.name));
  }
  return out;
}

export function checkRouteDeclarations(root) {
  const problems = [];
  const usedActions = new Set();
  const apiSrc = join(root, 'packages/api/src');
  let openapiCalls = 0;
  let guardCalls = 0;

  for (const f of listTs(apiSrc)) {
    const rel = f.replace(`${root}/`, '');
    const base = f.split('/').pop();
    const text = strip(readFileSync(f, 'utf8'));

    if (/\b(?:app|kit\.app|router)\s*\.(?:get|post|put|patch|delete|all|route|on)\s*\(/.test(text)) {
      problems.push(`${rel}: registers a route outside kit.app.openapi(createRoute({ middleware: routeGuard(...) }))`);
    }
    if (base !== 'declare.ts') guardCalls += (text.match(/\brouteGuard\(/g) ?? []).length;

    let idx = 0;
    while ((idx = text.indexOf('.openapi(', idx)) !== -1) {
      openapiCalls++;
      const open = idx + '.openapi'.length;
      const close = matchBracket(text, open);
      const call = text.slice(open, close + 1);
      idx = close > 0 ? close : idx + 1;

      const g = call.indexOf('routeGuard(kit,');
      if (g === -1 || !/createRoute\(\s*\{/.test(call)) {
        problems.push(`${rel}: an openapi() route has no routeGuard(kit, meta) in its createRoute middleware`);
        continue;
      }
      const guardOpen = call.indexOf('(', g);
      const guardClose = matchBracket(call, guardOpen);
      const guardText = call.slice(guardOpen, guardClose + 1);
      const metaOpen = guardText.indexOf('{');
      const meta = guardText.slice(metaOpen, matchBracket(guardText, metaOpen) + 1);
      const routeOnly = call.slice(0, g) + call.slice(guardClose + 1); // route's own method/path, without the meta

      const id = /id:\s*'([^']+)'/.exec(meta)?.[1] ?? 'unknown id';
      const where = `${rel} (${id})`;
      if (/auth:\s*'public'/.test(meta)) {
        if (!/reason:\s*'/.test(meta)) problems.push(`${where}: public route without reason`);
      } else if (/auth:\s*'session'/.test(meta)) {
        const action = /action:\s*'([a-z_]+:[a-z_]+)'/.exec(meta)?.[1];
        if (!action) problems.push(`${where}: missing action`);
        else usedActions.add(action);
        if (!/resource:\s*'[a-z_]+'/.test(meta)) problems.push(`${where}: missing resource`);
        if (!/tenant:\s*(true|false)/.test(meta)) problems.push(`${where}: missing tenant flag`);
      } else problems.push(`${where}: missing auth declaration`);

      const mMethod = /method:\s*'(\w+)'/.exec(meta)?.[1];
      const mPath = /path:\s*'([^']+)'/.exec(meta)?.[1];
      const rMethod = /method:\s*'(\w+)'/.exec(routeOnly)?.[1];
      const rPath = /path:\s*'([^']+)'/.exec(routeOnly)?.[1];
      if (!mMethod || !mPath || mMethod !== rMethod || mPath !== rPath) {
        problems.push(`${where}: meta method/path (${mMethod} ${mPath}) does not match the OpenAPI route (${rMethod} ${rPath})`);
      }
    }
  }
  if (openapiCalls !== guardCalls) problems.push(`openapi() calls (${openapiCalls}) and routeGuard() calls (${guardCalls}) differ`);

  let declared = [];
  try {
    const domain = readFileSync(join(root, 'packages/contracts/src/domain.ts'), 'utf8');
    const block = /export const ACTIONS = \[([\s\S]*?)\] as const;/.exec(domain)?.[1] ?? '';
    declared = [...block.matchAll(/'([a-z_]+:[a-z_]+)'/g)].map((m) => m[1]);
  } catch {
    /* handled below */
  }
  if (declared.length === 0) problems.push('could not read ACTIONS from contracts/domain.ts');
  for (const a of declared) if (!usedActions.has(a)) problems.push(`action "${a}" exists in the permission matrix but no route declares it`);
  for (const a of usedActions) if (!declared.includes(a)) problems.push(`route uses unknown action "${a}"`);
  return { problems, usedActions, openapiCalls };
}
