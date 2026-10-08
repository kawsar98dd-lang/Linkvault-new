import type { AuditLogDto } from '@bnlinkvault/contracts';
import { schema, withTenant, type Database } from '@bnlinkvault/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { WorkspaceCtx } from '../context.ts';
import { decodeCursor, toPage, type Page } from '../pagination.ts';

export class AuditQueryService {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async list(ctx: WorkspaceCtx, limit: number, rawCursor: string | undefined): Promise<Page<AuditLogDto>> {
    const cursor = decodeCursor(rawCursor);
    const rows = await withTenant(this.db, { userId: ctx.userId, workspaceId: ctx.workspaceId, requestId: ctx.requestId }, (tx) =>
      tx
        .select()
        .from(schema.auditLogs)
        .where(and(eq(schema.auditLogs.workspaceId, ctx.workspaceId), cursor ? sql`(${schema.auditLogs.ts}, ${schema.auditLogs.id}) < (${cursor.t}::timestamptz, ${cursor.id}::uuid)` : undefined))
        .orderBy(desc(schema.auditLogs.ts), desc(schema.auditLogs.id))
        .limit(limit + 1),
    );
    const page = toPage(rows, limit, (r) => ({ t: r.ts.toISOString(), id: r.id }));
    return {
      data: page.data.map((r) => ({
        id: r.id, ts: r.ts.toISOString(), actor_type: r.actorType, actor_id: r.actorId, action: r.action,
        resource_type: r.resourceType, resource_id: r.resourceId, request_id: r.requestId, metadata: r.metadata,
      })),
      next_cursor: page.next_cursor,
    };
  }
}
