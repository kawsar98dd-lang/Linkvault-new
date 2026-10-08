import { describe, expect, it } from 'vitest';
import { AppError, IDEMPOTENCY_KEY_RE, canonicalJson, decodeCursor, encodeCursor, requestFingerprint, toPage } from '../src/index.ts';

describe('cursor pagination', () => {
  it('round-trips and rejects tampered / malformed cursors', () => {
    const c = { t: '2026-01-01T00:00:00.000Z', id: 'abc' };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
    expect(decodeCursor(undefined)).toBeNull();
    const bad = (raw: string) => Buffer.from(raw).toString('base64url');
    for (const raw of ['not-base64-json', bad('[]'), bad('null'), bad('{"v":2,"t":"2026-01-01T00:00:00Z","id":"a"}'), bad('{"v":1,"t":"nope","id":"a"}'), bad('{"v":1,"t":"2026-01-01T00:00:00Z","id":""}'), bad(`{"v":1,"t":"2026-01-01T00:00:00Z","id":"${'x'.repeat(65)}"}`), bad('{"v":1,"t":5,"id":"a"}')]) {
      expect(() => decodeCursor(raw)).toThrow(AppError);
    }
  });
  it('toPage trims and emits next_cursor only when more rows exist', () => {
    const rows = [1, 2, 3].map((n) => ({ n }));
    const key = (r: { n: number }) => ({ t: '2026-01-01T00:00:00.000Z', id: String(r.n) });
    const p = toPage(rows, 2, key);
    expect(p.data).toHaveLength(2);
    expect(decodeCursor(p.next_cursor ?? undefined)?.id).toBe('2');
    expect(toPage(rows.slice(0, 2), 2, key).next_cursor).toBeNull();
    expect(toPage([], 2, key)).toEqual({ data: [], next_cursor: null });
  });
});

describe('idempotency fingerprint', () => {
  it('is order-insensitive for object keys and sensitive to content', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(canonicalJson({ a: [2, { c: 2, d: 1 }], b: 1 }));
    expect(requestFingerprint('post', '/x', { a: 1 })).toBe(requestFingerprint('POST', '/x', { a: 1 }));
    expect(requestFingerprint('POST', '/x', { a: 1 })).not.toBe(requestFingerprint('POST', '/x', { a: 2 }));
    expect(requestFingerprint('POST', '/x', { a: 1 })).not.toBe(requestFingerprint('POST', '/y', { a: 1 }));
    expect(canonicalJson({ a: undefined, b: null })).toBe('{"b":null}');
    expect(canonicalJson(undefined)).toBe('null');
  });
  it('validates key format', () => {
    expect(IDEMPOTENCY_KEY_RE.test('0b9f5a52-9c1e-4a7e-8d2c-1f3a4b5c6d7e')).toBe(true);
    expect(IDEMPOTENCY_KEY_RE.test('short')).toBe(false);
    expect(IDEMPOTENCY_KEY_RE.test('has space in it 123')).toBe(false);
  });
});
