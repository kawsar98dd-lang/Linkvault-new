import type { CreateWorkspaceBody, WorkspaceDto } from '@bnlinkvault/contracts';
import { schema, withTenant, withUser, type Database } from '@bnlinkvault/db';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { recordAudit } from '../audit.ts';
import type { Clock, UserCtx, WorkspaceCtx } from '../context.ts';
import { conflict, pgErrorCode } from '../errors.ts';
import { newUuid, newWorkspacePublicId } from '../ids.ts';
import { enqueueOutbox } from '../outbox.ts';
import { decodeCursor, toPage, type Page } from '../pagination.ts';

type CreateInput = z.infer<typeof CreateWorkspaceBody>;
export interface UpdateWorkspaceInput {
  name?: string | undefined;
  default_locale?: 'en' | 'bn' | undefined;
  timezone?: string | undefined;
}

const toDto = (w: typeof schema.workspaces.$inferSelect, role: WorkspaceDto['role']): WorkspaceDto => ({
  id: w.publicId,
  name: w.name,
  slug: w.slug,
  status: w.status,
  role,
  default_locale: w.defaultLocale,
  timezone: w.timezone,
  created_at: w.createdAt.toISOString(),
});

export class WorkspaceService {
  private readonly db: Database;
  private readonly clock: Clock;

  constructor(db: Database, clock: Clock) {
    this.db = db;
    this.clock = clock;
  }

  async create(ctx: UserCtx, input: CreateInput): Promise<WorkspaceDto> {
    const id = newUuid();
    const publicId = newWorkspacePublicId();
    try {
      await withTenant(this.db, { userId: ctx.userId, workspaceId: id, requestId: ctx.requestId }, async (tx) => {
        // No RETURNING on workspaces: the SELECT policy needs the membership inserted next.
        await tx.insert(schema.workspaces).values({
          id, publicId, name: input.name, slug: input.slug, ownerUserId: ctx.userId,
          defaultLocale: input.default_locale, timezone: input.timezone,
        });
        await tx.insert(schema.memberships).values({ workspaceId: id, userId: ctx.userId, role: 'owner' });
        await recordAudit(tx, {
          workspaceId: id, actorType: 'user', actorId: ctx.userId, action: 'workspace.created',
          resourceType: 'workspace', resourceId: publicId, requestId: ctx.requestId, metadata: { slug: input.slug },
        });
        await enqueueOutbox(tx, { workspaceId: id, aggregateType: 'workspace', aggregateId: publicId, eventType: 'workspace.created', payload: { workspace_id: publicId } });
      });
    } catch (error) {
      if (pgErrorCode(error) === '23505') throw conflict('workspace slug already in use');
      throw error;
    }
    return this.getByInternalId(ctx.userId, id);
  }

  private async getByInternalId(userId: string, id: string): Promise<WorkspaceDto> {
    return withTenant(this.db, { userId, workspaceId: id }, async (tx) => {
      const [row] = await tx
        .select({ w: schema.workspaces, role: schema.memberships.role })
        .from(schema.workspaces)
        .innerJoin(schema.memberships, and(eq(schema.memberships.workspaceId, schema.workspaces.id), eq(schema.memberships.userId, userId)))
        .where(eq(schema.workspaces.id, id));
      if (!row) throw new Error('workspace vanished after creation');
      return toDto(row.w, row.role);
    });
  }

  async list(ctx: UserCtx, limit: number, rawCursor: string | undefined): Promise<Page<WorkspaceDto>> {
    const cursor = decodeCursor(rawCursor);
    const rows = await withUser(this.db, { userId: ctx.userId, requestId: ctx.requestId }, (tx) =>
      tx
        .select({ w: schema.workspaces, role: schema.memberships.role })
        .from(schema.workspaces)
        .innerJoin(
          schema.memberships,
          and(eq(schema.memberships.workspaceId, schema.workspaces.id), eq(schema.memberships.userId, ctx.userId), eq(schema.memberships.status, 'active')),
        )
        .where(
          and(
            isNull(schema.workspaces.deletedAt),
            cursor ? sql`(${schema.workspaces.createdAt}, ${schema.workspaces.id}) < (${cursor.t}::timestamptz, ${cursor.id}::uuid)` : undefined,
          ),
        )
        .orderBy(desc(schema.workspaces.createdAt), desc(schema.workspaces.id))
        .limit(limit + 1),
    );
    const page = toPage(rows, limit, (r) => ({ t: r.w.createdAt.toISOString(), id: r.w.id }));
    return { data: page.data.map((r) => toDto(r.w, r.role)), next_cursor: page.next_cursor };
  }

  async get(ctx: WorkspaceCtx): Promise<WorkspaceDto> {
    return this.getByInternalId(ctx.userId, ctx.workspaceId);
  }

  async update(ctx: WorkspaceCtx, patch: UpdateWorkspaceInput): Promise<WorkspaceDto> {
    await withTenant(this.db, { userId: ctx.userId, workspaceId: ctx.workspaceId, requestId: ctx.requestId }, async (tx) => {
      const changes: Partial<typeof schema.workspaces.$inferInsert> = {};
      if (patch.name !== undefined) changes.name = patch.name;
      if (patch.default_locale !== undefined) changes.defaultLocale = patch.default_locale;
      if (patch.timezone !== undefined) changes.timezone = patch.timezone;
      await tx.update(schema.workspaces).set(changes).where(eq(schema.workspaces.id, ctx.workspaceId));
      await recordAudit(tx, {
        workspaceId: ctx.workspaceId, actorType: 'user', actorId: ctx.userId, action: 'workspace.updated',
        resourceType: 'workspace', resourceId: ctx.workspacePublicId, requestId: ctx.requestId, metadata: { fields: Object.keys(changes) },
      });
      await enqueueOutbox(tx, { workspaceId: ctx.workspaceId, aggregateType: 'workspace', aggregateId: ctx.workspacePublicId, eventType: 'workspace.updated', payload: { fields: Object.keys(changes) } });
    });
    return this.getByInternalId(ctx.userId, ctx.workspaceId);
  }

  /** Soft delete: the row is retained (audit/outbox integrity); access ends immediately via RLS. */
  async softDelete(ctx: WorkspaceCtx): Promise<void> {
    await withTenant(this.db, { userId: ctx.userId, workspaceId: ctx.workspaceId, requestId: ctx.requestId }, async (tx) => {
      // Audit + outbox FIRST: once deleted_at is set the actor is (correctly) no longer a member.
      await recordAudit(tx, {
        workspaceId: ctx.workspaceId, actorType: 'user', actorId: ctx.userId, action: 'workspace.deleted',
        resourceType: 'workspace', resourceId: ctx.workspacePublicId, requestId: ctx.requestId,
      });
      await enqueueOutbox(tx, { workspaceId: ctx.workspaceId, aggregateType: 'workspace', aggregateId: ctx.workspacePublicId, eventType: 'workspace.deleted', payload: {} });
      await tx.update(schema.workspaces).set({ deletedAt: this.clock.now(), status: 'deleting' }).where(eq(schema.workspaces.id, ctx.workspaceId));
    });
  }
}
