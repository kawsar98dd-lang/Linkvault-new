import { createHash, randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createUser, createWorkspace, harness, schema, withTenant, withUser, type Harness } from './helpers.ts';

let h: Harness;
let alice: { id: string; email: string };
let bob: { id: string; email: string };
let wsA: { id: string; publicId: string };
let wsB: { id: string; publicId: string };

beforeAll(async () => {
  h = harness();
  alice = await createUser(h.admin, 'alice');
  bob = await createUser(h.admin, 'bob');
  wsA = await createWorkspace(h.db, alice.id, `a-${randomBytes(4).toString('hex')}`);
  wsB = await createWorkspace(h.db, bob.id, `b-${randomBytes(4).toString('hex')}`);
  // Seed tenant rows in B through the legitimate path.
  await withTenant(h.db, { userId: bob.id, workspaceId: wsB.id }, async (tx) => {
    await tx.insert(schema.invitations).values({
      workspaceId: wsB.id, email: 'victim@example.test', role: 'viewer', invitedBy: bob.id,
      tokenHash: createHash('sha256').update('b-token').digest('hex'),
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    await tx.insert(schema.outboxEvents).values({
      workspaceId: wsB.id, aggregateType: 'workspace', aggregateId: wsB.publicId, eventType: 'workspace.created', payload: {},
    });
  });
});
afterAll(async () => { await h.close(); });

describe('RLS: fail-closed without context', () => {
  it('a raw app_rw session with no tenant context sees nothing', async () => {
    for (const t of ['workspaces', 'memberships', 'invitations', 'outbox_events', 'audit_logs', 'idempotency_keys']) {
      const { rows } = await h.appPool.query(`select count(*)::int as n from ${t}`);
      expect(rows[0].n, t).toBe(0);
    }
  });
});

describe('RLS: cross-tenant READ is blocked even without any WHERE clause', () => {
  it('workspace A context lists only workspace A', async () => {
    const rows = await withTenant(h.db, { userId: alice.id, workspaceId: wsA.id }, (tx) => tx.select().from(schema.workspaces));
    expect(rows.map((r) => r.id)).toEqual([wsA.id]);
  });
  it('alice forging workspace B in the context still sees nothing of B', async () => {
    await withTenant(h.db, { userId: alice.id, workspaceId: wsB.id }, async (tx) => {
      expect(await tx.select().from(schema.workspaces).where(sql`id = ${wsB.id}`)).toHaveLength(0);
      expect(await tx.select().from(schema.memberships)).toEqual(
        // only her OWN membership row (user_id = current user) may be visible, never B's
        [expect.objectContaining({ workspaceId: wsA.id, userId: alice.id })],
      );
      expect(await tx.select().from(schema.invitations)).toHaveLength(0);
      expect(await tx.select().from(schema.outboxEvents)).toHaveLength(0);
    });
  });
  it('looking up B by its primary key via A context returns no row (IDOR)', async () => {
    const rows = await withTenant(h.db, { userId: alice.id, workspaceId: wsA.id }, (tx) =>
      tx.select().from(schema.workspaces).where(sql`id = ${wsB.id}`));
    expect(rows).toHaveLength(0);
  });
});

describe('RLS: cross-tenant WRITE is blocked', () => {
  it('UPDATE of workspace B affects zero rows (both honest and forged context)', async () => {
    for (const ctxWs of [wsA.id, wsB.id]) {
      const res = await withTenant(h.db, { userId: alice.id, workspaceId: ctxWs }, (tx) =>
        tx.update(schema.workspaces).set({ name: 'pwned' }).where(sql`id = ${wsB.id}`).returning({ id: schema.workspaces.id }));
      expect(res).toHaveLength(0);
    }
    const { rows } = await h.admin.query('select name from workspaces where id = $1', [wsB.id]);
    expect(rows[0].name).not.toBe('pwned');
  });
  it('INSERT into B (invitation / membership / outbox) violates policy', async () => {
    await expect(withTenant(h.db, { userId: alice.id, workspaceId: wsB.id }, (tx) =>
      tx.insert(schema.invitations).values({
        workspaceId: wsB.id, email: 'x@example.test', role: 'admin', invitedBy: alice.id,
        tokenHash: createHash('sha256').update('x').digest('hex'), expiresAt: new Date(Date.now() + 1000),
      }))).rejects.toThrow(/row-level security|policy/i);
    await expect(withTenant(h.db, { userId: alice.id, workspaceId: wsB.id }, (tx) =>
      tx.insert(schema.memberships).values({ workspaceId: wsB.id, userId: alice.id, role: 'admin' }))).rejects.toThrow(/row-level security|policy/i);
    await expect(withTenant(h.db, { userId: alice.id, workspaceId: wsB.id }, (tx) =>
      tx.insert(schema.outboxEvents).values({ workspaceId: wsB.id, aggregateType: 'w', aggregateId: 'x', eventType: 'e', payload: {} }))).rejects.toThrow(/row-level security|policy/i);
  });
  it('privilege escalation via UPDATE of own membership in B is impossible', async () => {
    const res = await withTenant(h.db, { userId: alice.id, workspaceId: wsB.id }, (tx) =>
      tx.update(schema.memberships).set({ role: 'owner' }).where(sql`workspace_id = ${wsB.id}`).returning());
    expect(res).toHaveLength(0);
  });
});

describe('RLS: cross-tenant DELETE is blocked', () => {
  it('DELETE of B invitations removes nothing from A or forged contexts', async () => {
    for (const ctxWs of [wsA.id, wsB.id]) {
      const res = await withTenant(h.db, { userId: alice.id, workspaceId: ctxWs }, (tx) =>
        tx.delete(schema.invitations).where(sql`workspace_id = ${wsB.id}`).returning());
      expect(res).toHaveLength(0);
    }
    const { rows } = await h.admin.query('select count(*)::int as n from invitations where workspace_id = $1', [wsB.id]);
    expect(rows[0].n).toBe(1);
  });
  it('workspaces / memberships cannot be hard-deleted by app_rw at all', async () => {
    await expect(withTenant(h.db, { userId: bob.id, workspaceId: wsB.id }, (tx) =>
      tx.delete(schema.workspaces).where(sql`id = ${wsB.id}`))).rejects.toThrow(/permission denied/i);
    await expect(withTenant(h.db, { userId: bob.id, workspaceId: wsB.id }, (tx) =>
      tx.delete(schema.memberships).where(sql`workspace_id = ${wsB.id}`))).rejects.toThrow(/permission denied/i);
  });
});

describe('RLS: membership requirement and bootstrap', () => {
  it('a non-member cannot act inside a workspace even with the right GUC', async () => {
    const mallory = await createUser(h.admin, 'mallory');
    await expect(withTenant(h.db, { userId: mallory.id, workspaceId: wsB.id }, (tx) =>
      tx.insert(schema.outboxEvents).values({ workspaceId: wsB.id, aggregateType: 'w', aggregateId: 'x', eventType: 'e', payload: {} }))).rejects.toThrow(/row-level security|policy/i);
    expect(await withTenant(h.db, { userId: mallory.id, workspaceId: wsB.id }, (tx) => tx.select().from(schema.invitations))).toHaveLength(0);
  });
  it('bootstrap owner membership is one-time only and cannot be self-granted to others', async () => {
    const mallory = await createUser(h.admin, 'mallory2');
    const wsId = crypto.randomUUID();
    await withTenant(h.db, { userId: mallory.id, workspaceId: wsId }, (tx) =>
      tx.insert(schema.workspaces).values({ id: wsId, publicId: `ws_${randomBytes(10).toString('hex')}`, name: 'm', slug: `m-${randomBytes(4).toString('hex')}`, ownerUserId: mallory.id }));
    await expect(withTenant(h.db, { userId: mallory.id, workspaceId: wsId }, (tx) =>
      tx.insert(schema.memberships).values({ workspaceId: wsId, userId: alice.id, role: 'owner' }))).rejects.toThrow(/row-level security|policy/i);
    await withTenant(h.db, { userId: mallory.id, workspaceId: wsId }, (tx) =>
      tx.insert(schema.memberships).values({ workspaceId: wsId, userId: mallory.id, role: 'owner' }));
    await expect(withTenant(h.db, { userId: mallory.id, workspaceId: wsId }, (tx) =>
      tx.insert(schema.memberships).values({ workspaceId: wsId, userId: mallory.id, role: 'owner' }))).rejects.toThrow();
  });
  it('cannot create a workspace owned by someone else', async () => {
    const wsId = crypto.randomUUID();
    await expect(withTenant(h.db, { userId: alice.id, workspaceId: wsId }, (tx) =>
      tx.insert(schema.workspaces).values({ id: wsId, publicId: `ws_${randomBytes(10).toString('hex')}`, name: 'x', slug: `x-${randomBytes(4).toString('hex')}`, ownerUserId: bob.id }))).rejects.toThrow(/row-level security|policy/i);
  });
  it('DB enforces a single active owner per workspace', async () => {
    await expect(h.admin.query(`insert into memberships (workspace_id, user_id, role) values ($1, $2, 'owner')`, [wsA.id, bob.id])).rejects.toThrow(/duplicate key|unique/i);
  });
  it('withUser lists only the caller\'s workspaces', async () => {
    const rows = await withUser(h.db, { userId: alice.id }, (tx) => tx.select({ id: schema.workspaces.id }).from(schema.workspaces));
    expect(rows.map((r) => r.id)).toContain(wsA.id);
    expect(rows.map((r) => r.id)).not.toContain(wsB.id);
  });
  it('GUCs are transaction-local: nothing leaks to the next use of a pooled connection', async () => {
    await withTenant(h.db, { userId: alice.id, workspaceId: wsA.id }, () => Promise.resolve());
    const { rows } = await h.appPool.query(`select current_setting('app.workspace_id', true) as ws, current_setting('app.user_id', true) as u`);
    expect(rows[0].ws ?? '').toBe('');
    expect(rows[0].u ?? '').toBe('');
  });
});

describe('RLS: idempotency keys are private to (actor, workspace)', () => {
  it('another user cannot see or reuse a key', async () => {
    await withTenant(h.db, { userId: alice.id, workspaceId: wsA.id }, (tx) =>
      tx.insert(schema.idempotencyKeys).values({ actorUserId: alice.id, workspaceId: wsA.id, key: 'idem-key-0001', requestHash: 'h', expiresAt: new Date(Date.now() + 60_000) }));
    expect(await withTenant(h.db, { userId: bob.id, workspaceId: wsB.id }, (tx) => tx.select().from(schema.idempotencyKeys))).toHaveLength(0);
    await expect(withTenant(h.db, { userId: bob.id, workspaceId: wsB.id }, (tx) =>
      tx.insert(schema.idempotencyKeys).values({ actorUserId: alice.id, workspaceId: wsB.id, key: 'idem-key-0002', requestHash: 'h', expiresAt: new Date(Date.now() + 60_000) }))).rejects.toThrow(/row-level security|policy/i);
  });
});
