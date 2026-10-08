import { sql } from 'drizzle-orm';
import type { Tx } from '@bnlinkvault/db';
import { redact } from './observability/redact.ts';

export interface AuditEvent {
  workspaceId: string | null;
  actorType: 'user' | 'system' | 'staff';
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  requestId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Append-only audit write. Goes through audit_internal.write_event (SECURITY DEFINER, owned by
 * audit_writer): app_rw has no direct INSERT/UPDATE/DELETE on audit_logs. Metadata is redacted here
 * AND size-limited in the database. Runs inside the caller's transaction (atomic with the change).
 */
export async function recordAudit(tx: Tx, event: AuditEvent): Promise<void> {
  const metadata = redact(event.metadata ?? {});
  await tx.execute(sql`
    select audit_internal.write_event(
      ${event.workspaceId}::uuid, ${event.actorType}, ${event.actorId}, ${event.action},
      ${event.resourceType}, ${event.resourceId ?? null}, ${event.requestId ?? null}, ${JSON.stringify(metadata)}::jsonb)`);
}
