import type { AssignableRole, MemberDto } from '@bnlinkvault/contracts';
import { can, type Actor, type ResourceRef } from '@bnlinkvault/auth/policy';
import { schema, withTenant, type Database, type Tx } from '@bnlinkvault/db';
import { and, asc, eq, sql } from 'drizzle-orm';
import { recordAudit } from '../audit.ts';
import type { WorkspaceCtx } from '../context.ts';
import { AppError, forbidden, notFound } from '../errors.ts';
import { enqueueOutbox } from '../outbox.ts';
import { decodeCursor, toPage, type Page } from '../pagination.ts';

const actorOf = (ctx: WorkspaceCtx): Actor => ({ userId: ctx.userId, emailVerified: ctx.emailVerified, workspaceId: ctx.workspaceId, role: ctx.role });

function authorize(ctx: WorkspaceCtx, action: Parameters<typeof can>[1], extra: Partial<ResourceRef>): void {
  const decision = can(actorOf(ctx), action, { type: 'member', workspaceId: ctx.workspaceId, workspaceStatus: ctx.workspaceStatus, ...extra });
  if (!decision.allowed) throw forbidden(`denied: ${decision.reason}`);
}

async function loadTarget(tx: Tx, workspaceId: string, userId: string) {
  const [row] = await tx
    .select()
    .from(schema.memberships)
    .where(and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.userId, userId), eq(schema.memberships.status, 'active')))
    .for('update');
  if (!row) throw notFound();
  return row;
}

/** Serialises membership mutations per workspace (prevents racing owner transfers / role changes). */
const lockWorkspace = (tx: Tx, workspaceId: string) =>
  tx.execute(sql`select 1 from workspaces where id = ${workspaceId}::uuid for update`);

export class MemberService {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async list(ctx: WorkspaceCtx, limit: number, rawCursor: string | undefined): Promise<Page<MemberDto>> {
    const cursor = decodeCursor(rawCursor);
    const rows = await withTenant(this.db, { userId: ctx.userId, workspaceId: ctx.workspaceId, requestId: ctx.requestId }, (tx) =>
      tx
        .select({ m: schema.memberships, name: schema.user.name, email: schema.user.email })
        .from(schema.memberships)
        .innerJoin(schema.user, eq(schema.user.id, schema.memberships.userId))
        .where(
          and(
            eq(schema.memberships.workspaceId, ctx.workspaceId),
            eq(schema.memberships.status, 'active'),
            cursor ? sql`(${schema.memberships.createdAt}, ${schema.memberships.userId}) > (${cursor.t}::timestamptz, ${cursor.id})` : undefined,
          ),
        )
        .orderBy(asc(schema.memberships.createdAt), asc(schema.memberships.userId))
        .limit(limit + 1),
    );
    const page = toPage(rows, limit, (r) => ({ t: r.m.createdAt.toISOString(), id: r.m.userId }));
    return {
      data: page.data.map((r) => ({ user_id: r.m.userId, name: r.name, email: r.email, role: r.m.role, joined_at: r.m.createdAt.toISOString() })),
      next_cursor: page.next_cursor,
    };
  }

  async changeRole(ctx: WorkspaceCtx, targetUserId: string, newRole: AssignableRole): Promise<void> {
    await withTenant(this.db, { userId: ctx.userId, workspaceId: ctx.workspaceId, requestId: ctx.requestId }, async (tx) => {
      await lockWorkspace(tx, ctx.workspaceId);
      const target = await loadTarget(tx, ctx.workspaceId, targetUserId);
      authorize(ctx, 'member:update_role', { targetUserId, targetRole: target.role, newRole });
      await tx.update(schema.memberships).set({ role: newRole }).where(and(eq(schema.memberships.workspaceId, ctx.workspaceId), eq(schema.memberships.userId, targetUserId)));
      await recordAudit(tx, {
        workspaceId: ctx.workspaceId, actorType: 'user', actorId: ctx.userId, action: 'member.role_changed',
        resourceType: 'member', resourceId: targetUserId, requestId: ctx.requestId, metadata: { from: target.role, to: newRole },
      });
      await enqueueOutbox(tx, { workspaceId: ctx.workspaceId, aggregateType: 'member', aggregateId: targetUserId, eventType: 'member.role_changed', payload: { from: target.role, to: newRole } });
    });
  }

  async remove(ctx: WorkspaceCtx, targetUserId: string): Promise<void> {
    await withTenant(this.db, { userId: ctx.userId, workspaceId: ctx.workspaceId, requestId: ctx.requestId }, async (tx) => {
      await lockWorkspace(tx, ctx.workspaceId);
      const target = await loadTarget(tx, ctx.workspaceId, targetUserId);
      authorize(ctx, 'member:remove', { targetUserId, targetRole: target.role });
      await tx.update(schema.memberships).set({ status: 'removed' }).where(and(eq(schema.memberships.workspaceId, ctx.workspaceId), eq(schema.memberships.userId, targetUserId)));
      await recordAudit(tx, {
        workspaceId: ctx.workspaceId, actorType: 'user', actorId: ctx.userId, action: 'member.removed',
        resourceType: 'member', resourceId: targetUserId, requestId: ctx.requestId, metadata: { role: target.role },
      });
      await enqueueOutbox(tx, { workspaceId: ctx.workspaceId, aggregateType: 'member', aggregateId: targetUserId, eventType: 'member.removed', payload: {} });
    });
  }

  /** Owner-only. Demote first (frees the single-owner unique index), then promote, then re-point the workspace. */
  async transferOwnership(ctx: WorkspaceCtx, newOwnerUserId: string): Promise<void> {
    await withTenant(this.db, { userId: ctx.userId, workspaceId: ctx.workspaceId, requestId: ctx.requestId }, async (tx) => {
      await lockWorkspace(tx, ctx.workspaceId);
      const target = await loadTarget(tx, ctx.workspaceId, newOwnerUserId);
      const decision = can(actorOf(ctx), 'workspace:transfer_ownership', {
        type: 'workspace', workspaceId: ctx.workspaceId, workspaceStatus: ctx.workspaceStatus, targetUserId: newOwnerUserId,
      });
      if (!decision.allowed) throw forbidden(`denied: ${decision.reason}`);
      if (target.role === 'owner') throw new AppError('conflict', { message: 'target already owner' });

      await tx.update(schema.memberships).set({ role: 'admin' }).where(and(eq(schema.memberships.workspaceId, ctx.workspaceId), eq(schema.memberships.userId, ctx.userId), eq(schema.memberships.role, 'owner')));
      await tx.update(schema.memberships).set({ role: 'owner' }).where(and(eq(schema.memberships.workspaceId, ctx.workspaceId), eq(schema.memberships.userId, newOwnerUserId)));
      const moved = await tx.update(schema.workspaces).set({ ownerUserId: newOwnerUserId }).where(eq(schema.workspaces.id, ctx.workspaceId)).returning({ id: schema.workspaces.id });
      if (moved.length !== 1) throw new Error('ownership transfer did not update the workspace');
      await recordAudit(tx, {
        workspaceId: ctx.workspaceId, actorType: 'user', actorId: ctx.userId, action: 'workspace.ownership_transferred',
        resourceType: 'workspace', resourceId: ctx.workspacePublicId, requestId: ctx.requestId, metadata: { new_owner: newOwnerUserId },
      });
      await enqueueOutbox(tx, { workspaceId: ctx.workspaceId, aggregateType: 'workspace', aggregateId: ctx.workspacePublicId, eventType: 'workspace.ownership_transferred', payload: { new_owner: newOwnerUserId } });
    });
  }
}
