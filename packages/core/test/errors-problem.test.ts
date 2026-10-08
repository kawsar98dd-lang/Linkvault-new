import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError, ERROR_STATUS, forbidden, notFound, pgErrorCode, pgErrorMessage, toProblem, unauthenticated, conflict } from '../src/index.ts';

describe('AppError / helpers', () => {
  it('maps codes to HTTP statuses', () => {
    expect(notFound().status).toBe(404);
    expect(forbidden('x').status).toBe(403);
    expect(conflict().status).toBe(409);
    expect(unauthenticated().status).toBe(401);
    expect(new AppError('idempotency_key_reuse').status).toBe(422);
    for (const s of Object.values(ERROR_STATUS)) expect(s).toBeGreaterThanOrEqual(400);
  });
  it('extracts pg error info through wrappers', () => {
    expect(pgErrorCode({ code: '23505' })).toBe('23505');
    expect(pgErrorCode({ cause: { code: '42501' } })).toBe('42501');
    expect(pgErrorCode(new Error('plain'))).toBeUndefined();
    expect(pgErrorCode({ code: 'not-a-pg-code' })).toBeUndefined();
    expect(pgErrorMessage({ code: 'P0001', message: 'invitation_invalid' })).toBe('invitation_invalid');
    expect(pgErrorMessage({ cause: { code: 'P0001', message: 'inner' }, message: 'outer' })).toBe('inner');
    expect(pgErrorMessage(new Error('boom'))).toBe('boom');
    expect(pgErrorMessage('str')).toBe('');
  });
});

describe('toProblem', () => {
  const ctx = { requestId: 'req-1', instance: '/api/v1/x' };
  it('renders AppError safely and includes retry-after', () => {
    const p = toProblem(new AppError('rate_limited', { retryAfterSec: 2.2, message: 'internal detail' }), ctx);
    expect(p.status).toBe(429);
    expect(p.body).toMatchObject({ code: 'rate_limited', request_id: 'req-1', instance: '/api/v1/x', type: 'urn:bnlinkvault:problem:rate_limited' });
    expect(p.headers['retry-after']).toBe('3');
    expect(p.headers['content-type']).toContain('application/problem+json');
    expect(JSON.stringify(p.body)).not.toContain('internal detail');
  });
  it('maps ZodError to validation_failed with bounded field errors', () => {
    const r = z.object({ a: z.string() }).safeParse({ a: 1 });
    if (r.success) throw new Error('unreachable');
    const p = toProblem(r.error, { requestId: 'r' });
    expect(p.status).toBe(400);
    expect(p.body.errors?.[0]?.path).toBe('a');
  });
  it('never leaks unknown errors (stack, sql, driver messages)', () => {
    const p = toProblem(new Error('select * from users where password = $1 failed at /srv/app.js:10'), { requestId: 'r' });
    expect(p.status).toBe(500);
    expect(p.body.code).toBe('internal_error');
    expect(JSON.stringify(p.body)).not.toMatch(/select|password|\/srv/);
    expect(p.body.instance).toBeUndefined();
  });
  it('localises the title and omits empty field errors', () => {
    expect(toProblem(notFound(), { requestId: 'r', locale: 'bn' }).body.title).not.toBe(toProblem(notFound(), { requestId: 'r', locale: 'en' }).body.title);
    expect(toProblem(new AppError('validation_failed', { fieldErrors: [] }), { requestId: 'r' }).body.errors).toBeUndefined();
  });
});
