import { can, canCoarse, type Actor, type Decision } from '@bnlinkvault/auth/policy';
import { AppError, notFound, resolveWorkspaceForUser, unauthenticated } from '@bnlinkvault/core';
import type { MiddlewareHandler } from 'hono';
import type { ApiDeps, ApiEnv, RouteMeta } from '../types.ts';

type SessionMeta = Extract<RouteMeta, { auth: 'session' }>;

export function authenticate(deps: ApiDeps): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const session = await deps.auth.getSession(c.req.raw.headers);
    if (!session) throw unauthenticated();
    c.set('session', session);
    c.set('user', {
      userId: session.userId,
      email: session.email,
      name: session.name,
      emailVerified: session.emailVerified,
      requestId: c.get('requestId'),
    });
    return next();
  };
}

export function throwIfDenied(decision: Decision): void {
  if (decision.allowed) return;
  if (decision.reason === 'unauthenticated') throw unauthenticated();
  if (decision.reason === 'email_not_verified') throw new AppError('email_not_verified');
  throw new AppError('forbidden', { message: `denied: ${decision.reason}` });
}

/**
 * Resolves the workspace from the path SERVER-SIDE. Unknown workspace and non-membership are
 * indistinguishable (404): cross-tenant identifiers never reveal existence.
 */
export function resolveTenant(deps: ApiDeps): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const user = c.get('user');
    const publicId = c.req.param('ws');
    if (!publicId) throw notFound();
    const ws = await resolveWorkspaceForUser(deps.services.db, user.userId, publicId);
    if (!ws) throw notFound();
    c.set('tenant', {
      ...user,
      workspaceId: ws.id,
      workspacePublicId: ws.publicId,
      role: ws.role,
      workspaceStatus: ws.status,
    });
    return next();
  };
}

/** Coarse authorization from the route's DECLARED action/resource. Never ad-hoc per handler. */
export function authorize(meta: SessionMeta): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const tenant = meta.tenant ? c.get('tenant') : undefined;
    const user = c.get('user');
    const actor: Actor = {
      userId: user.userId,
      emailVerified: user.emailVerified,
      workspaceId: tenant?.workspaceId ?? null,
      role: tenant?.role ?? null,
    };
    throwIfDenied(
      canCoarse(actor, meta.action, {
        type: meta.resource,
        workspaceId: tenant?.workspaceId ?? null,
        ...(tenant ? { workspaceStatus: tenant.workspaceStatus } : {}),
      }),
    );
    return next();
  };
}

export { can };
