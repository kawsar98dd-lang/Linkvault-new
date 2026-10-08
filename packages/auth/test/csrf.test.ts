import { describe, expect, it } from 'vitest';
import { checkCsrf, checkOrigin, issueCsrfToken, verifyCsrfToken } from '../src/csrf.ts';

const SECRET = 's'.repeat(40);
const ALLOWED = ['https://app.example'];
const base = { method: 'POST', origin: 'https://app.example', secFetchSite: 'same-origin', allowedOrigins: ALLOWED };

describe('checkOrigin', () => {
  it('lets safe methods through', () => {
    expect(checkOrigin({ ...base, method: 'GET', origin: 'https://evil.example' }).ok).toBe(true);
  });
  it('accepts allowed origins and rejects others (cross-origin attempt)', () => {
    expect(checkOrigin(base).ok).toBe(true);
    expect(checkOrigin({ ...base, origin: 'https://evil.example' })).toEqual({ ok: false, reason: 'origin_mismatch' });
    expect(checkOrigin({ ...base, origin: 'null' })).toEqual({ ok: false, reason: 'origin_mismatch' });
  });
  it('falls back to Fetch Metadata when Origin is absent', () => {
    expect(checkOrigin({ ...base, origin: null, secFetchSite: 'same-origin' }).ok).toBe(true);
    expect(checkOrigin({ ...base, origin: null, secFetchSite: 'none' }).ok).toBe(true);
    expect(checkOrigin({ ...base, origin: null, secFetchSite: 'cross-site' })).toEqual({ ok: false, reason: 'cross_site' });
    expect(checkOrigin({ ...base, origin: null, secFetchSite: 'same-site' })).toEqual({ ok: false, reason: 'cross_site' });
    expect(checkOrigin({ ...base, origin: null, secFetchSite: null })).toEqual({ ok: false, reason: 'missing_origin' });
  });
});

describe('csrf tokens', () => {
  it('verifies a token bound to the same session', () => {
    const t = issueCsrfToken(SECRET, 'sess-1');
    expect(verifyCsrfToken(SECRET, 'sess-1', t)).toBe(true);
  });
  it('rejects tokens for another session, secret, or malformed input', () => {
    const t = issueCsrfToken(SECRET, 'sess-1');
    expect(verifyCsrfToken(SECRET, 'sess-2', t)).toBe(false);
    expect(verifyCsrfToken('x'.repeat(40), 'sess-1', t)).toBe(false);
    expect(verifyCsrfToken(SECRET, 'sess-1', null)).toBe(false);
    expect(verifyCsrfToken(SECRET, 'sess-1', '')).toBe(false);
    expect(verifyCsrfToken(SECRET, 'sess-1', 'onlyonepart')).toBe(false);
    expect(verifyCsrfToken(SECRET, 'sess-1', 'a.b.c')).toBe(false);
    expect(verifyCsrfToken(SECRET, 'sess-1', '.sig')).toBe(false);
    expect(verifyCsrfToken(SECRET, 'sess-1', 'nonce.')).toBe(false);
    expect(verifyCsrfToken(SECRET, 'sess-1', 'nonce.AAAA')).toBe(false);
  });
  it('detects tampering with the nonce', () => {
    const t = issueCsrfToken(SECRET, 'sess-1', 'fixednonce');
    expect(verifyCsrfToken(SECRET, 'sess-1', t.replace('fixednonce', 'othernonce'))).toBe(false);
  });
});

describe('checkCsrf', () => {
  const token = issueCsrfToken(SECRET, 'sess-1');
  const input = { ...base, secret: SECRET, sessionId: 'sess-1', token };
  it('passes a valid same-origin request', () => {
    expect(checkCsrf(input)).toEqual({ ok: true });
  });
  it('rejects missing and invalid tokens', () => {
    expect(checkCsrf({ ...input, token: null })).toEqual({ ok: false, reason: 'missing_token' });
    expect(checkCsrf({ ...input, token: 'x.y' })).toEqual({ ok: false, reason: 'invalid_token' });
  });
  it('rejects cross-origin attempts even with a valid token', () => {
    expect(checkCsrf({ ...input, origin: 'https://evil.example' })).toEqual({ ok: false, reason: 'origin_mismatch' });
  });
  it('does not require a token for safe methods', () => {
    expect(checkCsrf({ ...input, method: 'GET', token: null })).toEqual({ ok: true });
  });
});
