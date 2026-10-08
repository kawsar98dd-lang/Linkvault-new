import { sql } from 'drizzle-orm';
import type { Database, Tx } from './client.ts';

/**
 * Tenant propagation into PostgreSQL.
 * Every request-scoped query MUST run through withTenant()/withUser(): they open a transaction and
 * set transaction-local GUCs (set_config(..., is_local => true)) that the RLS policies read.
 * Local settings vanish at COMMIT/ROLLBACK, so pooled connections never leak a tenant.
 */
export interface UserContext {
  userId: string;
  requestId?: string;
}
export interface TenantContext extends UserContext {
  workspaceId: string;
}

export class InvalidTenantContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTenantContextError';
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function assertUserId(userId: string): void {
  if (typeof userId !== 'string' || userId.length === 0 || userId.length > 128 || userId.includes('\u0000')) {
    throw new InvalidTenantContextError('invalid userId');
  }
}
function assertWorkspaceId(workspaceId: string): void {
  if (typeof workspaceId !== 'string' || !UUID_RE.test(workspaceId)) {
    throw new InvalidTenantContextError('invalid workspaceId');
  }
}

const STATEMENT_TIMEOUT_MS = '15000';

async function bind(tx: Tx, userId: string, workspaceId: string): Promise<void> {
  await tx.execute(
    sql`select set_config('app.user_id', ${userId}, true), set_config('app.workspace_id', ${workspaceId}, true), set_config('statement_timeout', ${STATEMENT_TIMEOUT_MS}, true)`,
  );
}

/** Runs `fn` inside a transaction bound to (user, workspace). RLS enforces isolation. */
export async function withTenant<T>(db: Database, ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  assertUserId(ctx.userId);
  assertWorkspaceId(ctx.workspaceId);
  return db.transaction(async (tx) => {
    await bind(tx, ctx.userId, ctx.workspaceId);
    return fn(tx);
  });
}

/** User-scoped transaction without a workspace (e.g. listing the caller's own workspaces). */
export async function withUser<T>(db: Database, ctx: UserContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  assertUserId(ctx.userId);
  return db.transaction(async (tx) => {
    await bind(tx, ctx.userId, '');
    return fn(tx);
  });
}

/**
 * Re-binds the workspace inside an already-open transaction. Only for flows where the workspace
 * becomes known mid-transaction (invitation acceptance). The membership must already exist.
 */
export async function rebindWorkspace(tx: Tx, ctx: TenantContext): Promise<void> {
  assertUserId(ctx.userId);
  assertWorkspaceId(ctx.workspaceId);
  await bind(tx, ctx.userId, ctx.workspaceId);
}
