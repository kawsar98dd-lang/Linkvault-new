import { sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createUser, createWorkspace, harness, schema, withTenant, type Harness } from './helpers.ts';

let h: Harness;
let alice: { id: string };
let bob: { id: string };
let wsA: { id: string };
let wsB: { id: string };

const audit = (tx: Parameters<Parameters<typeof withTenant>[2]>[0], ws: string | null, actor: string, action = 'test.event') =>
  tx.execute(sql`select audit_internal.write_event(${ws}::uuid, 'user', ${actor}, ${action}, 'workspace', 'x', 'req-1', ${JSON.stringify({ k: 1 })}::jsonb) as id`);

beforeAll(async () => {
  h = harness();
  alice = await createUser(h.admin, 'alice');
  bob = await createUser(h.admin, 'bob');
  wsA = await createWorkspace(h.db, alice.id, `a-${randomBytes(4).toString('hex')}`);
  wsB = await createWorkspace(h.db, bob.id, `b-${randomBytes(4).toString('hex')}`);
});
afterAll(async () => { await h.close(); });

describe('audit log (append-only, role separated)', () => {
  it('app_rw can write ONLY through the definer function and read its own workspace', async () => {
    await withTenant(h.db, { userId: alice.id, workspaceId: wsA.id }, (tx) => audit(tx, wsA.id, alice.id));
    const rows = await withTenant(h.db, { userId: alice.id, workspaceId: wsA.id }, (tx) => tx.select().from(schema.auditLogs));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe('test.event');
    expect(await withTenant(h.db, { userId: bob.id, workspaceId: wsB.id }, (tx) => tx.select().from(schema.auditLogs))).toHaveLength(0);
  });
  it('direct INSERT / UPDATE / DELETE by app_rw is denied', async () => {
    await expect(withTenant(h.db, { userId: alice.id, workspaceId: wsA.id }, (tx) =>
      tx.insert(schema.auditLogs).values({ workspaceId: wsA.id, actorType: 'user', actorId: alice.id, action: 'forged', resourceType: 'x' }))).rejects.toThrow(/permission denied/i);
    await expect(withTenant(h.db, { userId: alice.id, workspaceId: wsA.id }, (tx) =>
      tx.update(schema.auditLogs).set({ action: 'tampered' }))).rejects.toThrow(/permission denied/i);
    await expect(withTenant(h.db, { userId: alice.id, workspaceId: wsA.id }, (tx) =>
      tx.delete(schema.auditLogs))).rejects.toThrow(/permission denied/i);
  });
  it('even the table owner cannot UPDATE/DELETE/TRUNCATE (immutability triggers)', async () => {
    await expect(h.admin.query(`update audit_logs set action = 'x'`)).rejects.toThrow(/append-only/);
    await expect(h.admin.query('delete from audit_logs')).rejects.toThrow(/append-only/);
    await expect(h.admin.query('truncate audit_logs')).rejects.toThrow(/append-only/);
  });
  it('cannot write audit rows for another workspace or impersonate another actor', async () => {
    await expect(withTenant(h.db, { userId: alice.id, workspaceId: wsA.id }, (tx) => audit(tx, wsB.id, alice.id))).rejects.toThrow(/audit_scope_violation/);
    await expect(withTenant(h.db, { userId: alice.id, workspaceId: wsA.id }, (tx) => audit(tx, wsA.id, bob.id))).rejects.toThrow(/audit_actor_violation/);
  });
  it('a non-member with a forged workspace context cannot write audit rows into that workspace', async () => {
    await expect(withTenant(h.db, { userId: bob.id, workspaceId: wsA.id }, (tx) => audit(tx, wsA.id, bob.id))).rejects.toThrow(/audit_scope_violation/);
  });
  it('rejects oversized metadata', async () => {
    await expect(withTenant(h.db, { userId: alice.id, workspaceId: wsA.id }, (tx) =>
      tx.execute(sql`select audit_internal.write_event(${wsA.id}::uuid, 'user', ${alice.id}, 'big', 'x', null, null, ${JSON.stringify({ blob: 'x'.repeat(9000) })}::jsonb)`))).rejects.toThrow(/audit_metadata_too_large/);
  });
});
