import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { checkRouteDeclarations, matchBracket } from '../lib/route-declarations.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DOMAIN = "export const ACTIONS = [\n  'workspace:read',\n  'workspace:update',\n] as const;\n";

function fixture(routes, domain = DOMAIN) {
  const root = mkdtempSync(join(tmpdir(), 'rd-'));
  for (const [p, c] of Object.entries({ 'packages/contracts/src/domain.ts': domain, 'packages/api/src/routes/r.ts': routes })) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), c);
  }
  return root;
}
const route = (meta, method = 'get', path = '/w') =>
  `kit.app.openapi(\n  createRoute({ middleware: routeGuard(kit, ${meta}), method: '${method}', path: '${path}', responses: {} }),\n  (c) => c.json({}, 200),\n);\n`;
const good = (id, action) => route(`{ id: '${id}', method: 'get', path: '/w', auth: 'session', action: '${action}', resource: 'workspace', tenant: false }`);

test('the REAL repository passes (18 routes, 18 actions)', () => {
  const r = checkRouteDeclarations(REPO);
  assert.deepEqual(r.problems, []);
  assert.equal(r.openapiCalls, 18);
  assert.equal(r.usedActions.size, 18);
});

test('matchBracket honours nesting and string literals', () => {
  assert.equal(matchBracket("f({ a: ')' , b: [1, (2)] })", 1), 26);
  assert.equal(matchBracket('(((', 0), -1);
});

test('accepts a complete declaration set', () => {
  const r = fixture(good('a', 'workspace:read') + good('b', 'workspace:update').replace("'/w'", "'/w'"));
  const out = checkRouteDeclarations(r);
  assert.ok(out.problems.every((p) => !/missing|without|unknown/.test(p)), out.problems.join('; '));
});

test('rejects an openapi() route without routeGuard', () => {
  const p = checkRouteDeclarations(fixture("kit.app.openapi(createRoute({ method: 'get', path: '/w', responses: {} }), (c) => c.json({}, 200));"));
  assert.ok(p.problems.some((x) => /no routeGuard/.test(x)));
});

test('rejects raw router registration that bypasses the guard', () => {
  const p = checkRouteDeclarations(fixture("kit.app.get('/rogue', (c) => c.text('x'));\n" + good('a', 'workspace:read') + good('b', 'workspace:update')));
  assert.ok(p.problems.some((x) => /outside kit\.app\.openapi/.test(x)));
});

test('rejects incomplete meta: missing action/resource/tenant/auth/reason', () => {
  const noAction = checkRouteDeclarations(fixture(route("{ id: 'a', method: 'get', path: '/w', auth: 'session', resource: 'workspace', tenant: false }")));
  assert.ok(noAction.problems.some((x) => /missing action/.test(x)));
  const noResource = checkRouteDeclarations(fixture(route("{ id: 'a', method: 'get', path: '/w', auth: 'session', action: 'workspace:read', tenant: false }")));
  assert.ok(noResource.problems.some((x) => /missing resource/.test(x)));
  const noTenant = checkRouteDeclarations(fixture(route("{ id: 'a', method: 'get', path: '/w', auth: 'session', action: 'workspace:read', resource: 'workspace' }")));
  assert.ok(noTenant.problems.some((x) => /missing tenant flag/.test(x)));
  const noAuth = checkRouteDeclarations(fixture(route("{ id: 'a', method: 'get', path: '/w' }")));
  assert.ok(noAuth.problems.some((x) => /missing auth declaration/.test(x)));
  const noReason = checkRouteDeclarations(fixture(route("{ id: 'a', method: 'get', path: '/w', auth: 'public' }")));
  assert.ok(noReason.problems.some((x) => /public route without reason/.test(x)));
});

test('rejects meta whose method/path differ from the OpenAPI route', () => {
  const p = checkRouteDeclarations(fixture(route("{ id: 'a', method: 'get', path: '/other', auth: 'session', action: 'workspace:read', resource: 'workspace', tenant: false }")));
  assert.ok(p.problems.some((x) => /does not match the OpenAPI route/.test(x)));
});

test('rejects unknown actions and permission-matrix actions that no route uses', () => {
  const p = checkRouteDeclarations(fixture(good('a', 'workspace:read')));
  assert.ok(p.problems.some((x) => /"workspace:update" exists in the permission matrix but no route declares it/.test(x)));
  const q = checkRouteDeclarations(fixture(good('a', 'workspace:nuke')));
  assert.ok(q.problems.some((x) => /unknown action "workspace:nuke"/.test(x)));
});
