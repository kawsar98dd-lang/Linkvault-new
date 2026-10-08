import { issueCsrfToken } from '@bnlinkvault/auth/csrf';
import { DisabledCaptchaVerifier, InMemoryRateLimiter, MemoryMailer, createCoreServices, createLogger, noopTracer, type RateLimiter } from '@bnlinkvault/core';
import { TestAuthPort } from '@bnlinkvault/testing';
import type { Hono } from 'hono';
import { createApiApp, type ApiApp, type ApiDeps } from '../src/index.ts';
import type { Harness } from '../../db/test/helpers.ts';

export const ORIGIN = 'http://localhost:3000';
export const CSRF_SECRET = 'c'.repeat(48);

export interface Ctx {
  api: ApiApp;
  auth: TestAuthPort;
  mailer: MemoryMailer;
  deps: ApiDeps;
}

export function buildApi(h: Harness, over: Partial<ApiDeps> = {}): Ctx {
  const mailer = new MemoryMailer();
  const logger = createLogger({ level: 'error', sink: () => undefined });
  const auth = new TestAuthPort();
  const deps: ApiDeps = {
    services: createCoreServices({ db: h.db, mailer, logger, appUrl: ORIGIN }),
    auth,
    rateLimiter: new InMemoryRateLimiter(),
    captcha: new DisabledCaptchaVerifier(),
    captchaMode: 'off',
    logger,
    tracer: noopTracer,
    csrfSecret: CSRF_SECRET,
    allowedOrigins: [ORIGIN],
    isProduction: false,
    ...over,
  };
  return { api: createApiApp(deps), auth, mailer, deps };
}

export interface CallOptions {
  json?: unknown;
  idem?: string;
  csrf?: boolean | string;
  origin?: string | null;
  headers?: Record<string, string>;
}

export async function call(app: Hono, sessionId: string | null, method: string, path: string, o: CallOptions = {}): Promise<{ status: number; body: unknown; headers: Headers }> {
  const headers: Record<string, string> = { ...(o.headers ?? {}) };
  if (sessionId) headers['x-test-session'] = sessionId;
  if (o.origin !== null) headers.origin = o.origin ?? ORIGIN;
  if (sessionId && o.csrf !== false) headers['x-csrf-token'] = typeof o.csrf === 'string' ? o.csrf : issueCsrfToken(CSRF_SECRET, sessionId);
  if (o.idem) headers['idempotency-key'] = o.idem;
  if (o.json !== undefined) headers['content-type'] = 'application/json';
  const res = await app.request(`/api/v1${path}`, { method, headers, body: o.json === undefined ? undefined : JSON.stringify(o.json) });
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body, headers: res.headers };
}

export type { RateLimiter };
