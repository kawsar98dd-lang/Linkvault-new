import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCoreServices, createLogger, hashToken, MemoryMailer, requestFingerprint, resolveWorkspaceForUser, type CoreServices, type UserCtx, type WorkspaceCtx } from '../src/index.ts';
import { createUser, harness, type Harness } from '../../db/test/helpers.ts';

let h: Harness;
let svc: CoreServices;
const mailer = new MemoryMailer();
const slug = (p: string): string => `${p}-${randomBytes(4).toString('hex')}`;

const userCtx = (u: { id: string; email: string }, over: Partial<UserCtx> = {}): UserCtx => ({
  userId: u.id, email: u.email, name: u.id, emailVerified: true, requestId: `req-${randomBytes(3).toString('hex')}`, ...over,
});
async function wsCtx(u: { id: string; email: string }, publicId: string): Promise<WorkspaceCtx> {
  const r = await resolveWorkspaceForUser(h.db, u.id, publicId);
  if (!r) throw new Error('not a member');
  return { ...userCtx(u), workspaceId: r.id, workspacePublicId: r.publicId, role: r.role, workspaceStatus: r.status };
}
const tokenFromMail = (): string => {
  const last = mailer.sent[mailer.sent.length - 1];
  const m = /#token=([A-Za-z0-9_-]+)/.exec(last?.text ?? '');
  if (!m?.[1]) throw new Error('no token in mail');
  return m[1];
};

beforeAll(() => {
  h = harness();
  svc = createCoreServices({ db: h.db, mailer, logger: createLogger({ level: 'error', sink: () => undefined }), appUrl: 'http://localhost:3000' });
});
afterAll(async () => { await h.close(); });

describe('workspace lifecycle', () => {
  it('creates, conflicts on slug, lists with cursor pagination', async () => {
    const u = await createUser(h.admin, 'wl');
    const s = slug('wl');
    const created = await svc.workspaces.create(userCtx(u), { name: 'WL', slug: s, default_locale: 'en', timezone: 'UTC' });
    expect(created).toMatchObject({ slug: s, role: 'owner', status: 'active' });
    expect(created.id).toMatch(/^ws_[a-z0-9]{20}$/);
    await expect(svc.workspaces.create(userCtx(u), { name: 'dup', slug: s, default_locale: 'en', timezone: 'UTC' })).rejects.toMatchObject({ code: 'conflict' });
    await svc.workspaces.create(userCtx(u), { name: 'B', slug: slug('wl'), default_locale: 'en', timezone: 'UTC' });
    await svc.workspaces.create(userCtx(u), { name: 'C', slug: slug('wl'), default_locale: 'en', timezone: 'UTC' });
    const p1 = await svc.workspaces.list(userCtx(u), 2, undefined);
    expect(p1.data).toHaveLength(2);
    expect(p1.next_cursor).not.toBeNull();
    const p2 = await svc.workspaces.list(userCtx(u), 2, p1.next_cursor ?? undefined);
    expect(p2.data).toHaveLength(1);
    expect(p2.next_cursor).toBeNull();
    expect(new Set([...p1.data, ...p2.data].map((w) => w.id)).size).toBe(3);
  });
  it('update + soft delete end access immediately', async () => {
    const u = await createUser(h.admin, 'upd');
    const w = await svc.workspaces.create(userCtx(u), { name: 'U', slug: slug('upd'), default_locale: 'en', timezone: 'UTC' });
    const ctx = await wsCtx(u, w.id);
    expect((await svc.workspaces.update(ctx, { name: 'Renamed' })).name).toBe('Renamed');
    await svc.workspaces.softDelete(ctx);
    expect(await resolveWorkspaceForUser(h.db, u.id, w.id)).toBeNull();
  });
});

describe('tenant isolation at the service layer', () => {
  it('non-members cannot resolve another workspace (404-equivalent) and forged contexts fail', async () => {
    const a = await createUser(h.admin, 'iso-a');
    const b = await createUser(h.admin, 'iso-b');
    const wa = await svc.workspaces.create(userCtx(a), { name: 'A', slug: slug('iso'), default_locale: 'en', timezone: 'UTC' });
    expect(await resolveWorkspaceForUser(h.db, b.id, wa.id)).toBeNull();
    expect(await resolveWorkspaceForUser(h.db, b.id, 'ws_doesnotexist000000000')).toBeNull();
    const real = await wsCtx(a, wa.id);
    const forged: WorkspaceCtx = { ...userCtx(b), workspaceId: real.workspaceId, workspacePublicId: real.workspacePublicId, role: 'owner', workspaceStatus: 'active' };
    await expect(svc.workspaces.get(forged)).rejects.toThrow();
    await expect(svc.members.list(forged, 10, undefined)).resolves.toMatchObject({ data: [] });
    await svc.workspaces.update(forged, { name: 'pwn' }).catch(() => undefined);
    expect((await svc.workspaces.get(real)).name).toBe('A');
    await expect(svc.audit.list(forged, 10, undefined)).resolves.toMatchObject({ data: [] });
  });
});

describe('invitations, members, ownership', () => {
  it('full invitation flow stores only a token hash and releases the token only via email', async () => {
    const owner = await createUser(h.admin, 'own');
    const guest = await createUser(h.admin, 'guest');
    const w = await svc.workspaces.create(userCtx(owner), { name: 'I', slug: slug('inv'), default_locale: 'en', timezone: 'UTC' });
    const oc = await wsCtx(owner, w.id);

    const inv = await svc.invitations.create(oc, { email: guest.email, role: 'editor' });
    expect(JSON.stringify(inv)).not.toMatch(/token/i);
    const token = tokenFromMail();
    const { rows } = await h.admin.query('select token_hash from invitations where id = $1', [inv.id]);
    expect(rows[0].token_hash).toBe(hashToken(token));
    expect(rows[0].token_hash).not.toBe(token);
    await expect(svc.invitations.create(oc, { email: guest.email, role: 'viewer' })).rejects.toMatchObject({ code: 'conflict' });

    await expect(svc.invitations.accept(userCtx(guest, { emailVerified: false }), token)).rejects.toMatchObject({ code: 'forbidden' });
    const stranger = await createUser(h.admin, 'stranger');
    await expect(svc.invitations.accept(userCtx(stranger), token)).rejects.toMatchObject({ code: 'not_found' });
    await expect(svc.invitations.accept(userCtx(guest), 'x'.repeat(43))).rejects.toMatchObject({ code: 'not_found' });
    const accepted = await svc.invitations.accept(userCtx(guest), token);
    expect(accepted).toEqual({ workspaceId: w.id, role: 'editor' });
    await expect(svc.invitations.accept(userCtx(guest), token)).rejects.toMatchObject({ code: 'not_found' });

    const audit = await svc.audit.list(oc, 50, undefined);
    expect(audit.data.map((e) => e.action)).toEqual(expect.arrayContaining(['workspace.created', 'invitation.created', 'invitation.accepted']));
    expect(JSON.stringify(audit.data)).not.toContain(token);
  });

  it('role hierarchy, removal and ownership transfer', async () => {
    const owner = await createUser(h.admin, 'o2');
    const admin = await createUser(h.admin, 'a2');
    const editor = await createUser(h.admin, 'e2');
    const w = await svc.workspaces.create(userCtx(owner), { name: 'M', slug: slug('mem'), default_locale: 'en', timezone: 'UTC' });
    const oc = await wsCtx(owner, w.id);
    for (const [u, role] of [[admin, 'admin'], [editor, 'editor']] as const) {
      await svc.invitations.create(oc, { email: u.email, role });
      await svc.invitations.accept(userCtx(u), tokenFromMail());
    }
    const ac = await wsCtx(admin, w.id);
    await expect(svc.invitations.create(ac, { email: 'x@example.test', role: 'admin' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(svc.members.changeRole(ac, owner.id, 'viewer')).rejects.toMatchObject({ code: 'forbidden' });
    await expect(svc.members.changeRole(ac, admin.id, 'viewer')).rejects.toMatchObject({ code: 'forbidden' });
    await svc.members.changeRole(ac, editor.id, 'viewer');
    await expect(svc.members.transferOwnership(ac, admin.id)).rejects.toMatchObject({ code: 'forbidden' });

    const list = await svc.members.list(oc, 10, undefined);
    expect(list.data.map((m) => [m.user_id, m.role]).sort()).toEqual([[admin.id, 'admin'], [editor.id, 'viewer'], [owner.id, 'owner']].sort());

    await svc.members.transferOwnership(oc, admin.id);
    const { rows } = await h.admin.query(`select user_id, role from memberships where workspace_id = $1 and status='active' order by user_id`, [oc.workspaceId]);
    expect(Object.fromEntries(rows.map((r) => [r.user_id, r.role]))).toEqual({ [admin.id]: 'owner', [owner.id]: 'admin', [editor.id]: 'viewer' });
    const own = await h.admin.query('select owner_user_id from workspaces where id = $1', [oc.workspaceId]);
    expect(own.rows[0].owner_user_id).toBe(admin.id);

    const newOwner = await wsCtx(admin, w.id);
    await svc.members.remove(newOwner, editor.id);
    expect(await resolveWorkspaceForUser(h.db, editor.id, w.id)).toBeNull();
    await expect(svc.members.remove(newOwner, owner.id)).resolves.toBeUndefined();
  });

  it('revoke makes a pending invitation unusable', async () => {
    const owner = await createUser(h.admin, 'rv');
    const guest = await createUser(h.admin, 'rvg');
    const w = await svc.workspaces.create(userCtx(owner), { name: 'R', slug: slug('rv'), default_locale: 'en', timezone: 'UTC' });
    const oc = await wsCtx(owner, w.id);
    const inv = await svc.invitations.create(oc, { email: guest.email, role: 'viewer' });
    const token = tokenFromMail();
    await svc.invitations.revoke(oc, inv.id);
    await expect(svc.invitations.revoke(oc, inv.id)).rejects.toMatchObject({ code: 'not_found' });
    await expect(svc.invitations.accept(userCtx(guest), token)).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('idempotency store', () => {
  it('reserve -> replay -> mismatch -> in_progress -> release, scoped per actor', async () => {
    const a = await createUser(h.admin, 'ida');
    const b = await createUser(h.admin, 'idb');
    const scope = { userId: a.id, workspaceId: null, key: 'key-0001-abcdef', fingerprint: requestFingerprint('POST', '/x', { n: 1 }) };
    const first = await svc.idempotency.begin(scope);
    expect(first.kind).toBe('fresh');
    expect((await svc.idempotency.begin(scope)).kind).toBe('in_progress');
    if (first.kind !== 'fresh') throw new Error('unreachable');
    await svc.idempotency.complete(scope, first.id, 201, { ok: true });
    expect(await svc.idempotency.begin(scope)).toEqual({ kind: 'replay', status: 201, body: { ok: true } });
    expect((await svc.idempotency.begin({ ...scope, fingerprint: requestFingerprint('POST', '/x', { n: 2 }) })).kind).toBe('mismatch');
    expect((await svc.idempotency.begin({ ...scope, userId: b.id })).kind).toBe('fresh'); // another actor: independent
    const retry = { ...scope, key: 'key-0002-abcdef' };
    const r1 = await svc.idempotency.begin(retry);
    if (r1.kind !== 'fresh') throw new Error('unreachable');
    await svc.idempotency.release(retry, r1.id);
    expect((await svc.idempotency.begin(retry)).kind).toBe('fresh');
  });
  it('is workspace-scoped: same key in another workspace is a different reservation', async () => {
    const u = await createUser(h.admin, 'idw');
    const w1 = await svc.workspaces.create(userCtx(u), { name: '1', slug: slug('idw'), default_locale: 'en', timezone: 'UTC' });
    const w2 = await svc.workspaces.create(userCtx(u), { name: '2', slug: slug('idw'), default_locale: 'en', timezone: 'UTC' });
    const c1 = await wsCtx(u, w1.id);
    const c2 = await wsCtx(u, w2.id);
    const fp = requestFingerprint('POST', '/y', {});
    expect((await svc.idempotency.begin({ userId: u.id, workspaceId: c1.workspaceId, key: 'shared-key-0001', fingerprint: fp })).kind).toBe('fresh');
    expect((await svc.idempotency.begin({ userId: u.id, workspaceId: c2.workspaceId, key: 'shared-key-0001', fingerprint: fp })).kind).toBe('fresh');
  });
});
