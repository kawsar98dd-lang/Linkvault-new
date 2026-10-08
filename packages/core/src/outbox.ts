import { schema, type Tx } from '@bnlinkvault/db';
import { redact } from './observability/redact.ts';

export interface OutboxEvent {
  workspaceId: string | null;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
}

/**
 * Transactional outbox: the event is committed atomically with the state change.
 * Phase 2 only records events; publishers/consumers arrive with Phase 3+.
 * (No RETURNING: system events with a NULL workspace are intentionally not selectable by app_rw.)
 */
export async function enqueueOutbox(tx: Tx, event: OutboxEvent): Promise<void> {
  await tx.insert(schema.outboxEvents).values({
    workspaceId: event.workspaceId,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    eventType: event.eventType,
    payload: redact(event.payload) as Record<string, unknown>,
  });
}
