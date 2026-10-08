import { describe, expect, it } from 'vitest';
import { REDACTED, createLogger, noopTracer, parseTraceparent, redact, redactString, tracingStatus } from '../src/index.ts';

describe('redact', () => {
  it('redacts sensitive keys at any depth', () => {
    const out = redact({ user: 'a', password: 'p', nested: { Authorization: 'Bearer abcdefgh12345', api_key: 'k', ok: 1 }, list: [{ session_token: 's' }] }) as Record<string, unknown>;
    expect(out.password).toBe(REDACTED);
    expect((out.nested as Record<string, unknown>).Authorization).toBe(REDACTED);
    expect((out.nested as Record<string, unknown>).api_key).toBe(REDACTED);
    expect((out.nested as Record<string, unknown>).ok).toBe(1);
    expect(((out.list as unknown[])[0] as Record<string, unknown>).session_token).toBe(REDACTED);
  });
  it('scrubs secrets embedded in strings', () => {
    expect(redactString('hdr Bearer abcdefghijkl end')).toContain(REDACTED);
    expect(redactString('postgres://user:pw@host/db')).toBe(`postgres://${REDACTED}@host/db`);
    expect(redactString('t=eyJhbGciOiJI.eyJzdWIiOiIx.c2lnbmF0dXJl')).toContain(REDACTED);
    expect(redactString('x'.repeat(3000)).endsWith('[truncated]')).toBe(true);
  });
  it('handles cycles, depth, errors, primitives and odd values', () => {
    const a: Record<string, unknown> = { n: 1 };
    a.self = a;
    expect((redact(a) as Record<string, unknown>).self).toBe('[Circular]');
    let deep: Record<string, unknown> = {};
    const root = deep;
    for (let i = 0; i < 10; i++) { deep.c = {}; deep = deep.c as Record<string, unknown>; }
    expect(JSON.stringify(redact(root))).toContain('[MaxDepth]');
    expect(redact(new Error('Bearer abcdefghijkl'))).toEqual({ name: 'Error', message: `Bearer ${REDACTED}` });
    expect(redact(new Date(0))).toBe('1970-01-01T00:00:00.000Z');
    expect(redact(10n)).toBe('10');
    expect(redact(() => 1)).toBeUndefined();
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
    expect(redact(true)).toBe(true);
    expect(redact(Symbol('x'))).toBeUndefined();
    expect(redact(Array.from({ length: 150 }, (_, i) => i))).toHaveLength(100);
    const big = Object.fromEntries(Array.from({ length: 150 }, (_, i) => [`k${i}`, i]));
    expect((redact(big) as Record<string, unknown>)['[truncated]']).toBe(true);
  });
});

describe('logger', () => {
  it('emits JSON, honours level, merges child fields and redacts', () => {
    const lines: string[] = [];
    const log = createLogger({ level: 'info', sink: (l) => lines.push(l), now: () => new Date(0), base: { service: 'web' } });
    log.debug('hidden');
    log.child({ request_id: 'r1' }).info('hello', { password: 'x', route: '/a' });
    log.warn('w'); log.error('e');
    expect(lines).toHaveLength(3);
    const first = JSON.parse(lines[0] as string) as Record<string, unknown>;
    expect(first).toMatchObject({ ts: '1970-01-01T00:00:00.000Z', level: 'info', msg: 'hello', service: 'web', request_id: 'r1', route: '/a', password: REDACTED });
  });
  it('debug level emits everything', () => {
    const lines: string[] = [];
    createLogger({ level: 'debug', sink: (l) => lines.push(l) }).debug('d');
    expect(lines).toHaveLength(1);
  });
});

describe('tracing', () => {
  it('noop tracer is honest about being inactive and runs the callback', async () => {
    expect(tracingStatus(noopTracer)).toBe('inactive');
    expect(tracingStatus({ ...noopTracer, kind: 'otel' })).toBe('active');
    expect(await noopTracer.withSpan('x', {}, (s) => { s.setAttribute('a', 1); s.recordError(new Error('e')); return Promise.resolve(7); })).toBe(7);
  });
  it('parses W3C traceparent strictly', () => {
    expect(parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01')).toEqual({ traceId: '4bf92f3577b34da6a3ce929d0e0e4736', spanId: '00f067aa0ba902b7' });
    for (const bad of [null, undefined, '', 'garbage', `00-${'0'.repeat(32)}-00f067aa0ba902b7-01`, `00-4bf92f3577b34da6a3ce929d0e0e4736-${'0'.repeat(16)}-01`]) expect(parseTraceparent(bad)).toBeNull();
  });
});
