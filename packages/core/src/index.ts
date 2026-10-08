import type { Database } from '@bnlinkvault/db';
import { type Clock, systemClock } from './context.ts';
import { IdempotencyStore } from './idempotency/store.ts';
import type { Mailer } from './mail/mailer.ts';
import type { Logger } from './observability/logger.ts';
import { AuditQueryService } from './workspaces/audit-query.ts';
import { InvitationService } from './workspaces/invitations.ts';
import { MemberService } from './workspaces/members.ts';
import { WorkspaceService } from './workspaces/workspaces.ts';

export * from './context.ts';
export * from './errors.ts';
export * from './problem.ts';
export * from './pagination.ts';
export * from './ids.ts';
export * from './audit.ts';
export * from './outbox.ts';
export * from './idempotency/fingerprint.ts';
export { IdempotencyStore } from './idempotency/store.ts';
export * from './mail/mailer.ts';
export * from './observability/logger.ts';
export * from './observability/redact.ts';
export * from './observability/tracing.ts';
export * from './security/rate-limit.ts';
export * from './security/captcha.ts';
export { resolveWorkspaceForUser, type ResolvedWorkspace } from './workspaces/access.ts';

export interface CoreDeps {
  db: Database;
  mailer: Mailer;
  logger: Logger;
  appUrl: string;
  clock?: Clock;
}

export interface CoreServices {
  db: Database;
  workspaces: WorkspaceService;
  members: MemberService;
  invitations: InvitationService;
  audit: AuditQueryService;
  idempotency: IdempotencyStore;
}

/** Composition of the domain modules (modular monolith: one process, explicit seams). */
export function createCoreServices(deps: CoreDeps): CoreServices {
  const clock = deps.clock ?? systemClock;
  return {
    db: deps.db,
    workspaces: new WorkspaceService(deps.db, clock),
    members: new MemberService(deps.db),
    invitations: new InvitationService({ db: deps.db, clock, mailer: deps.mailer, logger: deps.logger, appUrl: deps.appUrl }),
    audit: new AuditQueryService(deps.db),
    idempotency: new IdempotencyStore(deps.db, clock),
  };
}
