import { describe, expect, it } from 'vitest';
import { AUTH_RATE_RULES, DisabledCaptchaVerifier, InMemoryRateLimiter, TurnstileVerifier, captchaRequired, clientIp, hashToken, newOpaqueToken, newWorkspacePublicId, rateKey } from '../src/index.ts';

describe('InMemoryRateLimiter', () => {
  it('limits per key within the window and resets after it', async () => {
    let now = 0;
    const rl = new InMemoryRateLimiter(() => now);
    const rule = { name: 't', limit: 2, windowSec: 10 };
    expect((await rl.consume(rule, 'a')).allowed).toBe(true);
    expect((await rl.consume(rule, 'a')).remaining).toBe(0);
    const blocked = await rl.consume(rule, 'a');
    expect(blocked).toMatchObject({ allowed: false, retryAfterSec: 10 });
    expect((await rl.consume(rule, 'b')).allowed).toBe(true);
    now = 10_001;
    expect((await rl.consume(rule, 'a')).allowed).toBe(true);
  });
  it('bounds memory (evicts expired, then clears)', async () => {
    let now = 0;
    const rl = new InMemoryRateLimiter(() => now, 3);
    const rule = { name: 't', limit: 1, windowSec: 1 };
    for (const k of ['a', 'b', 'c']) await rl.consume(rule, k);
    now = 2000;
    await rl.consume(rule, 'd'); // evicts expired
    const rl2 = new InMemoryRateLimiter(() => 0, 2);
    const long = { name: 't', limit: 1, windowSec: 1000 };
    for (const k of ['a', 'b', 'c']) await rl2.consume(long, k); // pressure with nothing expired: clear
    expect((await rl2.consume(long, 'a')).allowed).toBe(true);
  });
  it('has auth rules for the sensitive endpoints and hashes keys', () => {
    for (const r of Object.values(AUTH_RATE_RULES)) expect(r.limit).toBeGreaterThan(0);
    expect(rateKey('1.2.3.4', 'a@b.c')).toHaveLength(32);
    expect(rateKey('x', 'y')).not.toBe(rateKey('xy'));
  });
});

describe('clientIp', () => {
  it('prefers trusted headers and uses the LAST x-forwarded-for hop', () => {
    expect(clientIp(new Headers({ 'cf-connecting-ip': '1.1.1.1', 'x-forwarded-for': '9.9.9.9' }))).toBe('1.1.1.1');
    expect(clientIp(new Headers({ 'x-forwarded-for': 'spoofed, 2.2.2.2' }))).toBe('2.2.2.2');
    expect(clientIp(new Headers({ 'x-real-ip': '3.3.3.3' }))).toBe('3.3.3.3');
    expect(clientIp(new Headers())).toBe('unknown');
    expect(clientIp(new Headers({ 'x-real-ip': 'x'.repeat(100) }))).toBe('unknown');
  });
});

describe('captcha', () => {
  it('policy by mode and risk', () => {
    expect(captchaRequired('off', 'elevated')).toBe(false);
    expect(captchaRequired('on', 'low')).toBe(true);
    expect(captchaRequired('risk', 'low')).toBe(false);
    expect(captchaRequired('risk', 'elevated')).toBe(true);
  });
  it('disabled verifier approves', async () => {
    expect(await new DisabledCaptchaVerifier().verify()).toBe(true);
  });
  it('Turnstile verifier fails closed', async () => {
    const mk = (impl: typeof fetch) => new TurnstileVerifier('s', impl, 100);
    const ok = (body: unknown): typeof fetch => () => Promise.resolve(new Response(JSON.stringify(body)));
    expect(await mk(ok({ success: true })).verify('tok', { action: 'a', ip: '1.1.1.1' })).toBe(true);
    expect(await mk(ok({ success: true, action: 'a' })).verify('tok', { action: 'a', ip: 'unknown' })).toBe(true);
    expect(await mk(ok({ success: true, action: 'other' })).verify('tok', { action: 'a' })).toBe(false);
    expect(await mk(ok({ success: false })).verify('tok', { action: 'a' })).toBe(false);
    expect(await mk(ok({ success: true })).verify(null, { action: 'a' })).toBe(false);
    expect(await mk(ok({ success: true })).verify('x'.repeat(3000), { action: 'a' })).toBe(false);
    expect(await mk(() => Promise.resolve(new Response('no', { status: 500 }))).verify('t', { action: 'a' })).toBe(false);
    expect(await mk(() => Promise.reject(new Error('net'))).verify('t', { action: 'a' })).toBe(false);
  });
});

describe('ids', () => {
  it('generates well-formed non-sequential ids and hashes tokens', () => {
    const a = newWorkspacePublicId();
    expect(a).toMatch(/^ws_[a-z0-9]{20}$/);
    expect(newWorkspacePublicId()).not.toBe(a);
    const t = newOpaqueToken();
    expect(t.length).toBeGreaterThanOrEqual(43);
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(t)).toBe(hashToken(t));
  });
});
