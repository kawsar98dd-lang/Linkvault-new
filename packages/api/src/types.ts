import type { Action, ResourceType } from '@bnlinkvault/contracts';
import type { AuthPort, SessionInfo } from '@bnlinkvault/auth';
import type {
  CaptchaMode,
  CaptchaVerifier,
  CoreServices,
  Logger,
  RateLimiter,
  Tracer,
  UserCtx,
  WorkspaceCtx,
} from '@bnlinkvault/core';

export interface ApiDeps {
  services: CoreServices;
  auth: AuthPort;
  rateLimiter: RateLimiter;
  captcha: CaptchaVerifier;
  captchaMode: CaptchaMode;
  logger: Logger;
  tracer: Tracer;
  csrfSecret: string;
  /** Exact origins allowed to perform cookie-authenticated mutations. */
  allowedOrigins: readonly string[];
  isProduction: boolean;
}

export interface ApiEnv {
  Variables: {
    requestId: string;
    session: SessionInfo;
    user: UserCtx;
    tenant: WorkspaceCtx;
  };
}

type Method = 'get' | 'post' | 'patch' | 'delete';

/** Every route MUST declare this via `routeGuard(kit, meta)`; startup and CI fail on undeclared/unregistered routes. */
export type RouteMeta = { id: string; method: Method; path: string } & (
  | { auth: 'public'; reason: string }
  | {
      auth: 'session';
      action: Action;
      resource: ResourceType;
      /** true => path contains {ws}; membership is resolved server-side and cross-tenant => 404. */
      tenant: boolean;
      /** true => `Idempotency-Key` header is required and enforced. */
      idempotent?: boolean;
    }
);
