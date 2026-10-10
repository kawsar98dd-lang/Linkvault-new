import { AppError, IDEMPOTENCY_KEY_RE, requestFingerprint } from '@bnlinkvault/core';
import type { MiddlewareHandler } from 'hono';
import type { ApiDeps, ApiEnv } from '../types.ts';

async function readJsonBody(raw: Request): Promise<unknown> {
  const text = await raw.clone().text();
  if (text.length === 0) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text; // invalid JSON still fingerprints deterministically; validation rejects it later
  }
}

/**
 * Enforces Idempotency-Key on declared routes. Scope = (actor, workspace, key); the fingerprint
 * binds the key to method + path + canonical body so a key cannot be replayed on a different request.
 */
export function idempotency(deps: ApiDeps, tenantScoped: boolean): MiddlewareHandler<ApiEnv> {
  return async (c, next): Promise<Response | undefined> => {
    const key = c.req.header('idempotency-key');
    if (!key || !IDEMPOTENCY_KEY_RE.test(key)) {
      throw new AppError('validation_failed', { fieldErrors: [{ path: 'Idempotency-Key', message: 'a 8-128 character Idempotency-Key header is required' }] });
    }
    const user = c.get('user');
    const scope = {
      userId: user.userId,
      workspaceId: tenantScoped ? c.get('tenant').workspaceId : null,
      key,
      fingerprint: requestFingerprint(c.req.method, new URL(c.req.url).pathname, await readJsonBody(c.req.raw)),
    };
    const outcome = await deps.services.idempotency.begin(scope);
    if (outcome.kind === 'replay') {
      c.header('idempotent-replayed', 'true');
      if (outcome.status === 204) return c.body(null, 204);
      return c.json(outcome.body as object, outcome.status as 200);
    }
    if (outcome.kind === 'mismatch') throw new AppError('idempotency_key_reuse');
    if (outcome.kind === 'in_progress') throw new AppError('idempotency_in_progress', { retryAfterSec: 1 });

    try {
      await next();
    } catch (error) {
      await deps.services.idempotency.release(scope, outcome.id);
      throw error;
    }
    const status = c.res.status;
    if (status >= 500 || status === 429) {
      await deps.services.idempotency.release(scope, outcome.id);
      return undefined;
    }
    let body: unknown = null;
    try {
      body = await c.res.clone().json();
    } catch {
      body = null;
    }
    await deps.services.idempotency.complete(scope, outcome.id, status, body);
    return undefined;
  };
}
