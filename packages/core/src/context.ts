import type { Role, WorkspaceStatus } from '@bnlinkvault/contracts';

export interface Clock {
  now(): Date;
}
export const systemClock: Clock = { now: () => new Date() };

/** Authenticated user facts, resolved server-side from the session. */
export interface UserCtx {
  userId: string;
  email: string;
  name: string;
  emailVerified: boolean;
  requestId: string;
}

/** User + resolved workspace membership (validated server-side; never taken from the client). */
export interface WorkspaceCtx extends UserCtx {
  workspaceId: string;
  workspacePublicId: string;
  role: Role;
  workspaceStatus: WorkspaceStatus;
}
