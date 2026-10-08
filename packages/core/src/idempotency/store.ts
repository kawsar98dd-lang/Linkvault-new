import { and, eq, sql } from 'drizzle-orm';
import { schema, withTenant, withUser, type Database, type Tx } from '@bnlinkvault/db';
import type { Clock } from '../context.ts';

export const IDEMPOTENCY_TTL_MS = 24 * 3600 * 1000;
export const IN_PROGRESS_LOCK_MS = 60_000;

export interface IdempotencyScope {
  userId: string;
  workspaceId: string | null;
  key: string;
  fingerprint: string;
}

export type BeginOutcome =
  | { kind: 'fresh'; id: string }
  | { kind: 'replay'; status: number; body: unknown }
  | { kind: 'in_progress' }
  | { kind: 'mismatch' };

/**
 * Reserve/replay protocol, executed in its OWN transactions (separate from the business transaction):
 *  begin()    -> fresh | replay | in_progress | mismatch
 *  complete() -> stores the final response for later replays
 *  release()  -> drops the reservation after a non-replayable failure so the client may retry
 * Scope is (actor, workspace, key): the key cannot be reused across users or workspaces, and RLS
 * enforces the same boundary in the database.
 */
export class IdempotencyStore {
  private readonly db: Database;
  private readonly clock: Clock;

  constructor(db: Database, clock: Clock) {
    this.db = db;
    this.clock = clock;
  }

  private run<T>(scope: IdempotencyScope, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return scope.workspaceId === null
      ? withUser(this.db, { userId: scope.userId }, fn)
      : withTenant(this.db, { userId: scope.userId, workspaceId: scope.workspaceId }, fn);
  }

  private scopeWhere(scope: IdempotencyScope) {
    return and(
      eq(schema.idempotencyKeys.actorUserId, scope.userId),
      eq(schema.idempotencyKeys.key, scope.key),
      scope.workspaceId === null
        ? sql`${schema.idempotencyKeys.workspaceId} IS NULL`
        : eq(schema.idempotencyKeys.workspaceId, scope.workspaceId),
    );
  }

  async begin(scope: IdempotencyScope): Promise<BeginOutcome> {
    const now = this.clock.now();
    return this.run(scope, async (tx) => {
      const inserted = await tx
        .insert(schema.idempotencyKeys)
        .values({
          actorUserId: scope.userId,
          workspaceId: scope.workspaceId,
          key: scope.key,
          requestHash: scope.fingerprint,
          expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
          lockedAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: schema.idempotencyKeys.id });
      if (inserted[0]) return { kind: 'fresh', id: inserted[0].id } satisfies BeginOutcome;

      const [existing] = await tx.select().from(schema.idempotencyKeys).where(this.scopeWhere(scope)).for('update');
      if (!existing) return { kind: 'in_progress' } satisfies BeginOutcome; // lost a race with a delete: caller retries
      if (existing.expiresAt <= now) {
        await tx.delete(schema.idempotencyKeys).where(eq(schema.idempotencyKeys.id, existing.id));
        const [re] = await tx
          .insert(schema.idempotencyKeys)
          .values({ actorUserId: scope.userId, workspaceId: scope.workspaceId, key: scope.key, requestHash: scope.fingerprint, expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS), lockedAt: now })
          .returning({ id: schema.idempotencyKeys.id });
        return { kind: 'fresh', id: re?.id ?? existing.id } satisfies BeginOutcome;
      }
      if (existing.requestHash !== scope.fingerprint) return { kind: 'mismatch' } satisfies BeginOutcome;
      if (existing.status === 'completed' && existing.responseStatus !== null) {
        return { kind: 'replay', status: existing.responseStatus, body: existing.responseBody } satisfies BeginOutcome;
      }
      if (now.getTime() - existing.lockedAt.getTime() > IN_PROGRESS_LOCK_MS) {
        await tx.update(schema.idempotencyKeys).set({ lockedAt: now }).where(eq(schema.idempotencyKeys.id, existing.id));
        return { kind: 'fresh', id: existing.id } satisfies BeginOutcome; // stale lock: previous attempt died
      }
      return { kind: 'in_progress' } satisfies BeginOutcome;
    });
  }

  async complete(scope: IdempotencyScope, id: string, status: number, body: unknown): Promise<void> {
    await this.run(scope, (tx) =>
      tx
        .update(schema.idempotencyKeys)
        .set({ status: 'completed', responseStatus: status, responseBody: body })
        .where(and(eq(schema.idempotencyKeys.id, id), this.scopeWhere(scope))),
    );
  }

  async release(scope: IdempotencyScope, id: string): Promise<void> {
    await this.run(scope, (tx) => tx.delete(schema.idempotencyKeys).where(and(eq(schema.idempotencyKeys.id, id), this.scopeWhere(scope))));
  }
}
