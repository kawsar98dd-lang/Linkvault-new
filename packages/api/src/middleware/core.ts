import { negotiateLocale } from '@bnlinkvault/i18n';
import { AppError, toProblem } from '@bnlinkvault/core';
import type { Context, MiddlewareHandler } from 'hono';
import type { ApiDeps, ApiEnv } from '../types.ts';

const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export function requestId(): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const inbound = c.req.header('x-request-id');
    const id = inbound && REQUEST_ID_RE.test(inbound) ? inbound : crypto.randomUUID();
    c.set('requestId', id);
    c.header('x-request-id', id);
    c.header('cache-control', 'no-store');
    c.header('x-content-type-options', 'nosniff');
    await next();
  };
}

export function problemFromRequest(error: unknown, requestId: string, req: Request): Response {
  const p = toProblem(error, {
    requestId,
    instance: new URL(req.url).pathname,
    locale: negotiateLocale(req.headers.get('accept-language')),
  });
  return new Response(JSON.stringify(p.body), { status: p.status, headers: p.headers });
}

export function problemResponse(c: Context<ApiEnv>, error: unknown): Response {
  return problemFromRequest(error, c.get('requestId') ?? 'unknown', c.req.raw);
}

export function accessLog(deps: ApiDeps): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const started = performance.now();
    await next();
    const user = c.get('user') as ApiEnv['Variables']['user'] | undefined;
    const tenant = c.get('tenant') as ApiEnv['Variables']['tenant'] | undefined;
    deps.logger.info('request', {
      request_id: c.get('requestId'),
      method: c.req.method,
      route: c.req.routePath,
      status: c.res.status,
      duration_ms: Math.round(performance.now() - started),
      actor_id: user?.userId,
      workspace_id: tenant?.workspacePublicId,
    });
  };
}

export function onError(deps: ApiDeps) {
  return (error: unknown, c: Context<ApiEnv>): Response => {
    if (!(error instanceof AppError)) {
      // Full diagnostics go to logs/Sentry only; the response is a generic problem.
      deps.logger.error('unhandled error', { request_id: c.get('requestId'), route: c.req.routePath, error });
    } else if (error.status >= 500) {
      deps.logger.error('server error', { request_id: c.get('requestId'), code: error.code });
    }
    return problemResponse(c, error);
  };
}

export function notFoundHandler() {
  return (c: Context<ApiEnv>): Response => problemResponse(c, new AppError('not_found'));
}
