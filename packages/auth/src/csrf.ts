import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * CSRF protection for cookie-authenticated, state-changing requests.
 * Layers (all must pass): Origin / Fetch-Metadata validation + signed token bound to the session.
 * SameSite cookies are defence-in-depth only and are NOT relied upon.
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export type OriginVerdict =
  | { ok: true }
  | { ok: false; reason: 'origin_mismatch' | 'cross_site' | 'missing_origin' };

export interface OriginCheckInput {
  method: string;
  origin: string | null;
  secFetchSite: string | null;
  allowedOrigins: readonly string[];
}

export function checkOrigin(input: OriginCheckInput): OriginVerdict {
  if (SAFE_METHODS.has(input.method.toUpperCase())) return { ok: true };
  if (input.origin !== null) {
    return input.allowedOrigins.includes(input.origin) ? { ok: true } : { ok: false, reason: 'origin_mismatch' };
  }
  if (input.secFetchSite === 'same-origin' || input.secFetchSite === 'none') return { ok: true };
  if (input.secFetchSite === 'cross-site' || input.secFetchSite === 'same-site') {
    return { ok: false, reason: 'cross_site' };
  }
  return { ok: false, reason: 'missing_origin' };
}

const mac = (secret: string, sessionId: string, nonce: string): Buffer =>
  createHmac('sha256', secret).update(`v1.${sessionId}.${nonce}`).digest();

/** Token = `<nonce>.<hmac>` bound to the session id. Not stored client-side beyond memory. */
export function issueCsrfToken(secret: string, sessionId: string, nonce: string = randomBytes(18).toString('base64url')): string {
  return `${nonce}.${mac(secret, sessionId, nonce).toString('base64url')}`;
}

export function verifyCsrfToken(secret: string, sessionId: string, token: string | null | undefined): boolean {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [nonce, provided] = parts as [string, string];
  if (nonce.length === 0 || provided.length === 0) return false;
  const expected = mac(secret, sessionId, nonce);
  let given: Buffer;
  try {
    given = Buffer.from(provided, 'base64url');
  } catch {
    return false;
  }
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export type CsrfVerdict =
  | { ok: true }
  | { ok: false; reason: 'origin_mismatch' | 'cross_site' | 'missing_origin' | 'missing_token' | 'invalid_token' };

export interface CsrfCheckInput extends OriginCheckInput {
  secret: string;
  sessionId: string;
  token: string | null;
}

export function checkCsrf(input: CsrfCheckInput): CsrfVerdict {
  const origin = checkOrigin(input);
  if (!origin.ok) return origin;
  if (SAFE_METHODS.has(input.method.toUpperCase())) return { ok: true };
  if (!input.token) return { ok: false, reason: 'missing_token' };
  return verifyCsrfToken(input.secret, input.sessionId, input.token)
    ? { ok: true }
    : { ok: false, reason: 'invalid_token' };
}
