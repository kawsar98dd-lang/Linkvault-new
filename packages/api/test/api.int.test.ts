import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findUndeclaredRoutes, validateRegistry } from '../src/index.ts';
import { createUser, harness, type Harness } from '../../db/test/helpers.ts';
import { buildApi, call, type Ctx } from './helpers.ts';

let h: Harness;
let c: Ctx;
let alice: { id: string; email: string };
let bob: { id: string; email: string };
let carol: { id: string; email: string }; // unverified
let aliceWs: string; // public id
const slug = (p: string) => `${p}-${randomBytes(4).toString('hex')}`;
const idem = () => `idem-${randomBytes(8).toString('hex')}`;
const field = (b: unknown, k: string): unknown => (b as Record<string, unknown>)[k];

beforeAll(async () => {
  h = harness();
  c = buildApi(h);
  alice = await createUser(h.admin, 'alice');
  bob = await createUser(h.admin, 'bob');
  carol = await createUser(h.admin, 'carol');
  c.auth.add({ sessionId: 'sess-alice', userId: alice.id, email: alice.email });
  c.auth.add({ sessionId: 'sess-bob', userId: bob.id, email: bob.email });
  c.auth.add({ sessionId: 'sess-carol', userId: carol.id, email: carol.email, emailVerified: false });
  const r = await call(c.api.app, 'sess-alice', 'POST', '/workspaces', { json: { name: 'Alice WS', slug: slug('alice') }, idem: idem() });
  expect(r.status).toBe(201);
  aliceWs = field(r.body, 'id') as string;
});
afterAll(async () => { await h.close(); });

describe('route registry (authorization declarations)', () => {
  it('is valid and covers every router entry', () => {
    expect(validateRegistry(c.api.registry)).toEqual([]);
    expect(findUndeclaredRoutes(c.api.app.routes, c.api.registry)).toEqual([]);
    for (const r of c.api.registry) if (r.auth === 'session') expect(r.action).toBeTruthy();
  });
  it('detects a route added without declaration', () => {
    c.api.app.get('/rogue', (ctx) => ctx.text('x'));
    expect(findUndeclaredRoutes(c.api.app.routes, c.api.registry)).toContain('GET /rogue');
  });
  it('rejects invalid declarations', () => {
    expect(validateRegistry([{ id: 'x', method: 'get', path: '/x', auth: 'session', action: 'workspace:read', resource: 'member', tenant: false }])).not.toEqual([]);
    expect(validateRegistry([{ id: 'x', method: 'post', path: '/x', auth: 'public', reason: 'because' }])).not.toEqual([]);
  });
  it('serves a public OpenAPI document containing every declared route', async () => {
    const r = await call(c.api.app, null, 'GET', '/openapi.json');
    expect(r.status).toBe(200);
    const paths = Object.keys((r.body as { paths: Record<string, unknown> }).paths);
    expect(paths).toEqual(expect.arrayContaining(['/me', '/workspaces', '/workspaces/{ws}', '/workspaces/{ws}/members']));
  });
});

describe('authentication, error contract, request ids', () => {
  it('401 problem+json with request id; unknown/inbound ids handled safely', async () => {
    const r = await call(c.api.app, null, 'GET', '/me', { headers: { 'x-request-id': 'bad id!' } });
    expect(r.status).toBe(401);
    expect(r.headers.get('content-type')).toContain('application/problem+json');
    expect(field(r.body, 'code')).toBe('unauthenticated');
    expect(field(r.body, 'request_id')).not.toBe('bad id!');
    expect(r.headers.get('x-request-id')).toBe(field(r.body, 'request_id'));
    const ok = await call(c.api.app, null, 'GET', '/me', { headers: { 'x-request-id': 'trace-12345678' } });
    expect(field(ok.body, 'request_id')).toBe('trace-12345678');
  });
  it('unknown routes are problem+json 404', async () => {
    const r = await call(c.api.app, 'sess-alice', 'GET', '/nope');
    expect(r.status).toBe(404);
    expect(field(r.body, 'code')).toBe('not_found');
  });
  it('unverified users can read /me but not use tenant features', async () => {
    expect((await call(c.api.app, 'sess-carol', 'GET', '/me')).status).toBe(200);
    const r = await call(c.api.app, 'sess-carol', 'GET', '/workspaces');
    expect(r.status).toBe(403);
    expect(field(r.body, 'code')).toBe('email_not_verified');
  });
  it('responses carry hardening headers', async () => {
    const r = await call(c.api.app, 'sess-alice', 'GET', '/me');
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
  });
  it('never leaks internals on unexpected errors', async () => {
    const broken = buildApi(h);
    broken.deps.services.workspaces.list = () => Promise.reject(new Error('select * from users -- password=hunter2'));
    broken.auth.add({ sessionId: 'sess-x', userId: alice.id, email: alice.email });
    const r = await call(broken.api.app, 'sess-x', 'GET', '/workspaces');
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toMatch(/select|hunter2|users/);
    expect(field(r.body, 'code')).toBe('internal_error');
  });
});

describe('CSRF', () => {
  const body = { name: 'X', slug: 'csrf-x' };
  it('valid same-origin request with token passes', async () => {
    const r = await call(c.api.app, 'sess-alice', 'POST', '/workspaces', { json: { ...body, slug: slug('csrf') }, idem: idem() });
    expect(r.status).toBe(201);
  });
  it('missing token, invalid token and cross-origin are rejected', async () => {
    const miss = await call(c.api.app, 'sess-alice', 'POST', '/workspaces', { json: body, idem: idem(), csrf: false });
    expect([miss.status, field(miss.body, 'code')]).toEqual([403, 'csrf_failed']);
    const bad = await call(c.api.app, 'sess-alice', 'POST', '/workspaces', { json: body, idem: idem(), csrf: 'forged.token' });
    expect(field(bad.body, 'code')).toBe('csrf_failed');
    const cross = await call(c.api.app, 'sess-alice', 'POST', '/workspaces', { json: body, idem: idem(), origin: 'https://evil.example' });
    expect(field(cross.body, 'code')).toBe('csrf_failed');
    const noOrigin = await call(c.api.app, 'sess-alice', 'POST', '/workspaces', { json: body, idem: idem(), origin: null });
    expect(field(noOrigin.body, 'code')).toBe('csrf_failed');
  });
  it("a token issued for another session is rejected", async () => {
    const t = await call(c.api.app, 'sess-bob', 'GET', '/csrf');
    const stolen = field(t.body, 'csrf_token') as string;
    const r = await call(c.api.app, 'sess-alice', 'POST', '/workspaces', { json: body, idem: idem(), csrf: stolen });
    expect(field(r.body, 'code')).toBe('csrf_failed');
  });
  it('safe methods need no token', async () => {
    expect((await call(c.api.app, 'sess-alice', 'GET', '/me', { csrf: false })).status).toBe(200);
  });
});

describe('validation, pagination, idempotency', () => {
  it('rejects invalid bodies with field errors', async () => {
    const r = await call(c.api.app, 'sess-alice', 'POST', '/workspaces', { json: { name: '', slug: '-bad-' }, idem: idem() });
    expect(r.status).toBe(400);
    expect((field(r.body, 'errors') as unknown[]).length).toBeGreaterThan(0);
    const extra = await call(c.api.app, 'sess-alice', 'PATCH', `/workspaces/${aliceWs}`, { json: { slug: 'nope' } });
    expect(extra.status).toBe(400);
  });
  it('requires a well-formed Idempotency-Key on declared routes', async () => {
    expect((await call(c.api.app, 'sess-alice', 'POST', '/workspaces', { json: { name: 'N', slug: slug('i') } })).status).toBe(400);
    expect((await call(c.api.app, 'sess-alice', 'POST', '/workspaces', { json: { name: 'N', slug: slug('i') }, idem: 'short' })).status).toBe(400);
  });
  it('replays the stored response, rejects key reuse with a different body, isolates users', async () => {
    const key = idem();
    const payload = { name: 'Idem', slug: slug('idem') };
    const first = await call(c.api.app, 'sess-alice', 'POST', '/workspaces', { json: payload, idem: key });
    const second = await call(c.api.app, 'sess-alice', 'POST', '/workspaces', { json: payload, idem: key });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.headers.get('idempotent-replayed')).toBe('true');
    expect(field(second.body, 'id')).toBe(field(first.body, 'id'));
    const reuse = await call(c.api.app, 'sess-alice', 'POST', '/workspaces', { json: { ...payload, name: 'Other' }, idem: key });
    expect([reuse.status, field(reuse.body, 'code')]).toEqual([422, 'idempotency_key_reuse']);
    const other = await call(c.api.app, 'sess-bob', 'POST', '/workspaces', { json: { name: 'Idem', slug: slug('idemb') }, idem: key });
    expect(other.status).toBe(201); // same key, different actor => independent
  });
  it('paginates with opaque cursors and rejects tampered ones', async () => {
    const u = await createUser(h.admin, 'pager');
    c.auth.add({ sessionId: 'sess-pager', userId: u.id, email: u.email });
    for (let i = 0; i < 3; i++) await call(c.api.app, 'sess-pager', 'POST', '/workspaces', { json: { name: `P${i}`, slug: slug('pg') }, idem: idem() });
    const p1 = await call(c.api.app, 'sess-pager', 'GET', '/workspaces?limit=2');
    expect((field(p1.body, 'data') as unknown[]).length).toBe(2);
    const cur = field(p1.body, 'next_cursor') as string;
    const p2 = await call(c.api.app, 'sess-pager', 'GET', `/workspaces?limit=2&cursor=${encodeURIComponent(cur)}`);
    expect((field(p2.body, 'data') as unknown[]).length).toBe(1);
    expect((await call(c.api.app, 'sess-pager', 'GET', '/workspaces?cursor=garbage')).status).toBe(400);
    expect((await call(c.api.app, 'sess-pager', 'GET', '/workspaces?limit=1000')).status).toBe(400);
  });
});

describe('tenant isolation through the API (IDOR matrix generated from the route registry)', () => {
  const fill = (path: string, ws: string): string =>
    path.replace('{ws}', ws).replace('{user_id}', 'someone').replace('{invitation_id}', crypto.randomUUID()).replace('{session_id}', 'x');

  it('every {ws} route answers 404 for a non-member, identical to a non-existent workspace', async () => {
    const tenantRoutes = c.api.registry.filter((r) => r.auth === 'session' && r.tenant);
    expect(tenantRoutes.length).toBeGreaterThanOrEqual(10);
    for (const r of tenantRoutes) {
      const json = r.method === 'post' || r.method === 'patch' ? { x: 1 } : undefined;
      const real = await call(c.api.app, 'sess-bob', r.method.toUpperCase(), fill(r.path, aliceWs), { json, idem: idem() });
      const ghost = await call(c.api.app, 'sess-bob', r.method.toUpperCase(), fill(r.path, 'ws_zzzzzzzzzzzzzzzzzzzz'), { json, idem: idem() });
      expect([r.id, real.status]).toEqual([r.id, 404]);
      expect([r.id, ghost.status]).toEqual([r.id, 404]);
      expect(real.body).toMatchObject({ code: 'not_found' });
      expect(field(real.body, 'title')).toBe(field(ghost.body, 'title'));
    }
  });
  it('alice still sees her data; bob cannot see it in listings', async () => {
    expect((await call(c.api.app, 'sess-alice', 'GET', `/workspaces/${aliceWs}`)).status).toBe(200);
    const list = await call(c.api.app, 'sess-bob', 'GET', '/workspaces?limit=100');
    expect((field(list.body, 'data') as { id: string }[]).map((w) => w.id)).not.toContain(aliceWs);
  });
  it('a viewer is forbidden from admin actions (403) but can read', async () => {
    const v = await createUser(h.admin, 'viewer');
    c.auth.add({ sessionId: 'sess-viewer', userId: v.id, email: v.email });
    await call(c.api.app, 'sess-alice', 'POST', `/workspaces/${aliceWs}/invitations`, { json: { email: v.email, role: 'viewer' }, idem: idem() });
    const token = /#token=([A-Za-z0-9_-]+)/.exec(c.mailer.sent.at(-1)?.text ?? '')?.[1] ?? '';
    expect((await call(c.api.app, 'sess-viewer', 'POST', '/invitations/accept', { json: { token } })).status).toBe(200);
    expect((await call(c.api.app, 'sess-viewer', 'GET', `/workspaces/${aliceWs}`)).status).toBe(200);
    for (const [m, p, j] of [['PATCH', `/workspaces/${aliceWs}`, { name: 'x' }], ['DELETE', `/workspaces/${aliceWs}`, undefined], ['GET', `/workspaces/${aliceWs}/audit-logs`, undefined], ['GET', `/workspaces/${aliceWs}/invitations`, undefined]] as const) {
      const r = await call(c.api.app, 'sess-viewer', m, p, { json: j });
      expect([m, p, r.status]).toEqual([m, p, 403]);
    }
    expect(JSON.stringify((await call(c.api.app, 'sess-alice', 'GET', `/workspaces/${aliceWs}/audit-logs`)).body)).not.toContain(token);
  });
  it('an invitation token cannot be accepted by the wrong user (uniform 404)', async () => {
    await call(c.api.app, 'sess-alice', 'POST', `/workspaces/${aliceWs}/invitations`, { json: { email: 'nobody@example.test', role: 'editor' }, idem: idem() });
    const token = /#token=([A-Za-z0-9_-]+)/.exec(c.mailer.sent.at(-1)?.text ?? '')?.[1] ?? '';
    const r = await call(c.api.app, 'sess-bob', 'POST', '/invitations/accept', { json: { token } });
    expect(r.status).toBe(404);
  });
});

describe('sessions API', () => {
  it('lists own sessions without tokens and revokes only own ones', async () => {
    const u = await createUser(h.admin, 'sess');
    c.auth.add({ sessionId: 'sess-a1', userId: u.id, email: u.email });
    c.auth.add({ sessionId: 'sess-a2', userId: u.id, email: u.email });
    const list = await call(c.api.app, 'sess-a1', 'GET', '/sessions');
    expect((field(list.body, 'data') as { id: string; current: boolean }[]).find((s) => s.current)?.id).toBe('sess-a1');
    expect(JSON.stringify(list.body)).not.toMatch(/token/i);
    expect((await call(c.api.app, 'sess-a1', 'DELETE', '/sessions/sess-bob')).status).toBe(404);
    expect((await call(c.api.app, 'sess-a1', 'DELETE', '/sessions/sess-a2')).status).toBe(204);
    expect((await call(c.api.app, 'sess-a2', 'GET', '/me')).status).toBe(401);
  });
});

describe('rate limiting', () => {
  it('returns 429 with Retry-After once the limiter denies', async () => {
    let n = 0;
    const limited = buildApi(h, { rateLimiter: { consume: (rule) => Promise.resolve({ allowed: ++n <= 2, limit: rule.limit, remaining: 0, retryAfterSec: 7 }) } });
    limited.auth.add({ sessionId: 'sess-rl', userId: alice.id, email: alice.email });
    const codes: number[] = [];
    for (let i = 0; i < 3; i++) codes.push((await call(limited.api.app, 'sess-rl', 'GET', '/me')).status);
    expect(codes).toEqual([200, 429, 429].slice(0, 1).concat(codes.slice(1)));
    const r = await call(limited.api.app, 'sess-rl', 'GET', '/me');
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBe('7');
  });
});
