import { createHash, randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createUser, createWorkspace, harness, schema, withUser, withTenant, type Harness } from './helpers.ts';

let h: Harness;
let owner: { id: string };
let invitee: { id: string; email: string };
let other: { id: string; email: string };
let ws: { id: string };
const hash = (t: string): string => createHash('sha256').update(t).digest('hex');

async function invite(token: string, email: string, ttlMs = 3_600_000, role: 'admin' | 'editor' | 'viewer' = 'viewer') {
  await withTenant(h.db, { userId: owner.id, workspaceId: ws.id }, (tx) =>
    tx.insert(schema.invitations).values({ workspaceId: ws.id, email, role, invitedBy: owner.id, tokenHash: hash(token), expiresAt: new Date(Date.now() + ttlMs) }));
}
const accept = (userId: string, email: string, token: string) =>
  withUser(h.db, { userId }, (tx) => tx.execute(sql`select * from app.accept_invitation(${hash(token)}, ${userId}, ${email})`));

beforeAll(async () => {
  h = harness();
  owner = await createUser(h.admin, 'owner');
  invitee = await createUser(h.admin, 'invitee');
  other = await createUser(h.admin, 'other');
  ws = await createWorkspace(h.db, owner.id, `inv-${randomBytes(4).toString('hex')}`);
});
afterAll(async () => { await h.close(); });

describe('app.accept_invitation (the single audited RLS exception)', () => {
  it('accepts a valid invitation for the matching verified email exactly once', async () => {
    await invite('tok-valid', invitee.email, undefined, 'editor');
    const res = await accept(invitee.id, invitee.email, 'tok-valid');
    expect(res.rows[0]).toMatchObject({ out_workspace_id: ws.id, out_role: 'editor' });
    await expect(accept(invitee.id, invitee.email, 'tok-valid')).rejects.toThrow(/invitation_invalid/);
    const { rows } = await h.admin.query('select role, status from memberships where workspace_id=$1 and user_id=$2', [ws.id, invitee.id]);
    expect(rows[0]).toEqual({ role: 'editor', status: 'active' });
  });
  it('rejects a different user, unknown tokens, expired tokens and spoofed caller ids with one uniform error', async () => {
    await invite('tok-other', 'someone-else@example.test');
    await expect(accept(other.id, other.email, 'tok-other')).rejects.toThrow(/invitation_invalid/);
    await expect(accept(other.id, other.email, 'tok-does-not-exist')).rejects.toThrow(/invitation_invalid/);
    await invite('tok-expired', other.email, -1000);
    await expect(accept(other.id, other.email, 'tok-expired')).rejects.toThrow(/invitation_invalid/);
    await expect(withUser(h.db, { userId: other.id }, (tx) => tx.execute(sql`select * from app.accept_invitation(${hash('tok-other')}, ${invitee.id}, ${'someone-else@example.test'})`))).rejects.toThrow(/invitation_invalid/);
  });
  it('refuses to re-activate an existing active member (no silent role change of an owner)', async () => {
    const email = `owner-${randomBytes(3).toString('hex')}@example.test`;
    await h.admin.query('update users set email = $1 where id = $2', [email, owner.id]);
    await invite('tok-self', email, undefined, 'viewer');
    await expect(accept(owner.id, email, 'tok-self')).rejects.toThrow(/already_member/);
    const { rows } = await h.admin.query('select role from memberships where workspace_id=$1 and user_id=$2', [ws.id, owner.id]);
    expect(rows[0].role).toBe('owner');
  });
  it('app_rw cannot create memberships directly to join a workspace', async () => {
    await expect(withTenant(h.db, { userId: other.id, workspaceId: ws.id }, (tx) =>
      tx.insert(schema.memberships).values({ workspaceId: ws.id, userId: other.id, role: 'viewer' }))).rejects.toThrow(/row-level security|policy/i);
  });
});
