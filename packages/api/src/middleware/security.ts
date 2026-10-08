import { checkCsrf, issueCsrfToken } from '@bnlinkvault/auth/csrf';
import { API_RATE_RULES, AppError, clientIp, rateKey, type RateResult } from '@bnlinkvault/core';
import type { MiddlewareHandler } from 'hono';
import type { ApiDeps, ApiEnv } from '../types.ts';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

function setRateHeaders(c: Parameters<MiddlewareHandler<ApiEnv>>[0], r: RateResult): void {
  c.header('ratelimit-limit', String(r.limit));
  c.header('ratelimit-remaining', String(r.remaining));
}

/** Per-IP global limit for every request + per-user limit for mutations (after authentication). */
export function rateLimit(deps: ApiDeps, scope: 'ip' | 'user'): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    if (scope === 'user' && SAFE.has(c.req.method)) return next();
    const rule = scope === 'ip' ? API_RATE_RULES.global : API_RATE_RULES.mutation;
    const key = scope === 'ip' ? rateKey('ip', clientIp(c.req.raw.headers)) : rateKey('user', c.get('session').userId);
    const r = await deps.rateLimiter.consume(rule, key);
    setRateHeaders(c, r);
    if (!r.allowed) throw new AppError('rate_limited', { retryAfterSec: r.retryAfterSec });
    return next();
  };
}

/** CSRF for cookie-authenticated unsafe requests: Origin/Fetch-Metadata AND a session-bound token. */
export function csrf(deps: ApiDeps): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const verdict = checkCsrf({
      method: c.req.method,
      origin: c.req.header('origin') ?? null,
      secFetchSite: c.req.header('sec-fetch-site') ?? null,
      allowedOrigins: deps.allowedOrigins,
      secret: deps.csrfSecret,
      sessionId: c.get('session').sessionId,
      token: c.req.header('x-csrf-token') ?? null,
    });
    if (!verdict.ok) {
      deps.logger.warn('csrf rejected', { request_id: c.get('requestId'), reason: verdict.reason, route: c.req.routePath });
      throw new AppError('csrf_failed', { message: verdict.reason });
    }
    return next();
  };
}

export const csrfTokenFor = (deps: ApiDeps, sessionId: string): string => issueCsrfToken(deps.csrfSecret, sessionId);
