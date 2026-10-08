import { describe, expect, it } from 'vitest';
import { AppError, InMemoryRateLimiter, createLogger, type CaptchaVerifier } from '@bnlinkvault/core';
import { classifyAuthRequest, guardAuthRequest, type AuthGuardDeps } from '../src/auth-guard.ts';

const logger = createLogger({ level: 'error', sink: () => undefined });
const captchaStub = (result: boolean): CaptchaVerifier & { calls: number } => {
  const s = { calls: 0, verify: () => { s.calls++; return Promise.resolve(result); } };
  return s;
};
const deps = (over: Partial<AuthGuardDeps> = {}): AuthGuardDeps => ({
  rateLimiter: new InMemoryRateLimiter(), captcha: captchaStub(true), captchaMode: 'off', logger, ...over,
});
const post = (path: string, body: unknown = {}, headers: Record<string, string> = {}) =>
  new Request(`https://app.test${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '9.9.9.9', ...headers }, body: JSON.stringify(body) });
const status = async (r: Response | null) => (r ? r.status : 0);

describe('classifyAuthRequest', () => {
  it('maps sensitive endpoints to dedicated rules and challenge policy', () => {
    expect(classifyAuthRequest('/api/auth/sign-in/email')).toMatchObject({ action: 'sign_in', challenge: true, keyedByEmail: true });
    expect(classifyAuthRequest('/api/auth/sign-up/email').action).toBe('sign_up');
    expect(classifyAuthRequest('/api/auth/forget-password').action).toBe('password_reset');
    expect(classifyAuthRequest('/api/auth/reset-password').challenge).toBe(false);
    expect(classifyAuthRequest('/api/auth/send-verification-email').action).toBe('email_verification');
    expect(classifyAuthRequest('/api/auth/two-factor/verify-totp').action).toBe('two_factor');
    expect(classifyAuthRequest('/api/auth/anything-else').action).toBe('auth_other');
  });
});

describe('guardAuthRequest', () => {
  it('passes requests under the limit', async () => {
    expect(await guardAuthRequest(deps(), post('/api/auth/sign-in/email', { email: 'a@b.co' }), 'req-1')).toBeNull();
  });
  it('rate limits per IP and per account (email) with Retry-After', async () => {
    const d = deps();
    let blocked: Response | null = null;
    for (let i = 0; i < 11 && !blocked; i++) blocked = await guardAuthRequest(d, post('/api/auth/sign-in/email', { email: 'a@b.co' }, { 'cf-connecting-ip': `1.1.1.${i}` }), 'r');
    expect(blocked?.status).toBe(429); // same account from many IPs is still limited
    expect(blocked?.headers.get('retry-after')).toBeTruthy();
    const body = (await blocked?.json()) as { code: string };
    expect(body.code).toBe('rate_limited');
    const d2 = deps();
    let ipBlocked: Response | null = null;
    for (let i = 0; i < 11 && !ipBlocked; i++) ipBlocked = await guardAuthRequest(d2, post('/api/auth/sign-in/email', { email: `u${i}@b.co` }), 'r');
    expect(ipBlocked?.status).toBe(429); // one IP, many accounts
  });
  it('limits GET callbacks with the coarse rule and ignores malformed bodies', async () => {
    const d = deps();
    expect(await guardAuthRequest(d, new Request('https://app.test/api/auth/get-session', { headers: { 'cf-connecting-ip': '8.8.8.8' } }), 'r')).toBeNull();
    const bad = new Request('https://app.test/api/auth/sign-in/email', { method: 'POST', body: '{not json', headers: { 'cf-connecting-ip': '7.7.7.7' } });
    expect(await guardAuthRequest(d, bad, 'r')).toBeNull();
  });
  it('requires a solved challenge when Turnstile mode is on, and fails closed', async () => {
    const c = captchaStub(false);
    const r = await guardAuthRequest(deps({ captchaMode: 'on', captcha: c }), post('/api/auth/sign-up/email', { email: 'a@b.co' }), 'r');
    expect(r?.status).toBe(403);
    expect(((await r?.json()) as { code: string }).code).toBe('captcha_failed');
    expect(c.calls).toBe(1);
    expect(await status(await guardAuthRequest(deps({ captchaMode: 'on', captcha: captchaStub(true) }), post('/api/auth/sign-up/email', { email: 'a@b.co' }), 'r'))).toBe(0);
  });
  it('does not challenge non-credential endpoints or when mode is off; risk mode only when elevated', async () => {
    const c = captchaStub(false);
    expect(await guardAuthRequest(deps({ captchaMode: 'on', captcha: c }), post('/api/auth/reset-password', {}), 'r')).toBeNull();
    expect(await guardAuthRequest(deps({ captchaMode: 'off', captcha: c }), post('/api/auth/sign-in/email', { email: 'a@b.co' }), 'r')).toBeNull();
    expect(c.calls).toBe(0);
    const risk = deps({ captchaMode: 'risk', captcha: captchaStub(false) });
    expect(await guardAuthRequest(risk, post('/api/auth/sign-in/email', { email: 'x@b.co' }), 'r')).toBeNull(); // low risk
    let challenged: Response | null = null;
    for (let i = 0; i < 9 && !challenged; i++) challenged = await guardAuthRequest(risk, post('/api/auth/sign-in/email', { email: `x${i}@b.co` }), 'r');
    expect(challenged?.status).toBe(403); // budget more than half spent => elevated => challenge
    expect(new AppError('captcha_failed').status).toBe(403);
  });
});
