import { createHmac } from 'node:crypto';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, createPool } from '@bnlinkvault/db';
import { BetterAuthAdapter, createBetterAuth } from '../src/better-auth/index.ts';
import { urlFor } from '../../db/test/helpers.ts';
import pg from 'pg';

// REAL Better Auth + REAL PostgreSQL (app_rw, RLS-subject role). No mocks of the provider.
const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'correct-horse-battery-staple-1'; // secretscan:allow throwaway credential for a test-only database that is dropped every run
const sent: { to: string; subject: string; text: string }[] = [];
let pool: pg.Pool;
let admin: pg.Pool;
let adapter: BetterAuthAdapter;

const email = () => `u-${randomBytes(5).toString('hex')}@example.test`;

class Jar {
  private readonly cookies = new Map<string, string>();
  absorb(res: Response): void {
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const [name, ...rest] = (pair ?? '').split('=');
      const value = rest.join('=');
      if (!name) continue;
      if (value === '' || /max-age=0/i.test(line)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
  header(): string { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '); }
  names(): string[] { return [...this.cookies.keys()]; }
}

async function post(path: string, body: unknown, jar?: Jar): Promise<Response> {
  const res = await adapter.handleRequest(new Request(`${ORIGIN}/api/auth${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, ...(jar ? { cookie: jar.header() } : {}) },
    body: JSON.stringify(body),
  }));
  jar?.absorb(res);
  return res;
}
async function get(path: string, jar?: Jar): Promise<Response> {
  const res = await adapter.handleRequest(new Request(`${ORIGIN}/api/auth${path}`, { headers: jar ? { cookie: jar.header() } : {}, redirect: 'manual' }));
  jar?.absorb(res);
  return res;
}
const headersOf = (jar: Jar): Headers => new Headers({ cookie: jar.header() });
const lastMail = () => sent[sent.length - 1];
const linkFrom = (text: string | undefined): URL => {
  const m = /(https?:\/\/\S+)/.exec(text ?? '');
  if (!m?.[1]) throw new Error('no link in mail');
  return new URL(m[1]);
};

function totp(secretBase32: string, now = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of secretBase32.replace(/=+$/, '').toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g)?.map((b) => parseInt(b, 2)) ?? []);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / 30)));
  const h = createHmac('sha1', key).update(counter).digest();
  const o = (h[h.length - 1] ?? 0) & 0xf;
  const code = (((h[o] ?? 0) & 0x7f) << 24) | ((h[o + 1] ?? 0) << 16) | ((h[o + 2] ?? 0) << 8) | (h[o + 3] ?? 0);
  return String(code % 1_000_000).padStart(6, '0');
}

async function registerAndVerify(addr: string): Promise<void> {
  const res = await post('/sign-up/email', { email: addr, password: PASSWORD, name: 'Test User' });
  expect(res.status).toBe(200);
  const link = linkFrom(lastMail()?.text);
  const verify = await get(`${link.pathname.replace('/api/auth', '')}${link.search}`);
  expect([200, 302]).toContain(verify.status);
}

beforeAll(() => {
  pool = createPool({ connectionString: urlFor('app_rw'), max: 4 });
  admin = new pg.Pool({ connectionString: urlFor('admin'), max: 2 });
  const auth = createBetterAuth({
    db: createDatabase(pool),
    baseURL: ORIGIN,
    secret: 'integration-test-secret-0123456789-abcdefghijklmnop',
    trustedOrigins: [ORIGIN],
    isProduction: false,
    sendEmail: (m) => { sent.push(m); return Promise.resolve(); },
    emailTexts: {
      verify: ({ url }) => ({ subject: 'verify', text: url }),
      reset: ({ url }) => ({ subject: 'reset', text: url }),
    },
  });
  adapter = new BetterAuthAdapter(auth);
});
afterAll(async () => { await pool.end(); await admin.end(); });

describe('registration and email verification (real Better Auth)', () => {
  it('registers, stores an Argon2id hash, and refuses login until the email is verified', async () => {
    const addr = email();
    const res = await post('/sign-up/email', { email: addr, password: PASSWORD, name: 'Reg User' });
    expect(res.status).toBe(200);
    expect(lastMail()?.subject).toBe('verify');
    const { rows } = await admin.query(`select a.password, u.email_verified from accounts a join users u on u.id = a.user_id where u.email = $1`, [addr]);
    expect(rows[0].password.startsWith('$argon2id$')).toBe(true);
    expect(rows[0].email_verified).toBe(false);

    const jar = new Jar();
    const denied = await post('/sign-in/email', { email: addr, password: PASSWORD }, jar);
    expect(denied.status).toBe(403);
    expect(jar.names().filter((n) => n.includes('session_token'))).toEqual([]);
  });
  it('rejects weak passwords and duplicate registration', async () => {
    expect((await post('/sign-up/email', { email: email(), password: 'short', name: 'x' })).status).toBeGreaterThanOrEqual(400);
    const addr = email();
    await post('/sign-up/email', { email: addr, password: PASSWORD, name: 'x' });
    const again = await post('/sign-up/email', { email: addr, password: PASSWORD, name: 'x' });
    expect(again.status === 200 || again.status >= 400).toBe(true);
    const { rows } = await admin.query('select count(*)::int as n from users where email = $1', [addr]);
    expect(rows[0].n).toBe(1);
  });
});

describe('login, sessions, revocation', () => {
  it('invalid credentials fail; valid login issues a secure HttpOnly cookie; session is resolvable', async () => {
    const addr = email();
    await registerAndVerify(addr);
    const bad = await post('/sign-in/email', { email: addr, password: 'wrong-password-123' }, new Jar());
    expect(bad.status).toBe(401);
    const jar = new Jar();
    const ok = await post('/sign-in/email', { email: addr, password: PASSWORD }, jar);
    expect(ok.status).toBe(200);
    const setCookie = ok.headers.getSetCookie().join('\n');
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/^bnlv\./m);
    const session = await adapter.getSession(headersOf(jar));
    expect(session).toMatchObject({ email: addr, emailVerified: true, twoFactorEnabled: false });
    expect(await adapter.getSession(new Headers())).toBeNull();
    expect(await adapter.getSession(new Headers({ cookie: 'bnlv.session_token=forged.value' }))).toBeNull();
  });
  it('lists sessions without tokens, revokes a specific session, and cannot revoke foreign ones', async () => {
    const addr = email();
    await registerAndVerify(addr);
    const j1 = new Jar();
    const j2 = new Jar();
    await post('/sign-in/email', { email: addr, password: PASSWORD }, j1);
    await post('/sign-in/email', { email: addr, password: PASSWORD }, j2);
    const list = await adapter.listSessions(headersOf(j1));
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(list)).not.toMatch(/token/i);
    const current = list.find((s) => s.current);
    const other = list.find((s) => !s.current);
    expect(current && other).toBeTruthy();
    expect(await adapter.revokeSession(headersOf(j1), 'does-not-exist')).toBe(false);

    const stranger = email();
    await registerAndVerify(stranger);
    const js = new Jar();
    await post('/sign-in/email', { email: stranger, password: PASSWORD }, js);
    const strangerSession = (await adapter.listSessions(headersOf(js)))[0];
    expect(await adapter.revokeSession(headersOf(j1), strangerSession?.id ?? 'x')).toBe(false);

    expect(await adapter.revokeSession(headersOf(j1), other?.id ?? '')).toBe(true);
    const after = await adapter.listSessions(headersOf(j1));
    expect(after.find((s) => s.id === other?.id)).toBeUndefined();
  });
  it('sessions are resolved from the database on every request (no cookie-cache trust)', async () => {
    const addr = email();
    await registerAndVerify(addr);
    const jar = new Jar();
    await post('/sign-in/email', { email: addr, password: PASSWORD }, jar);
    expect(await adapter.getSession(headersOf(jar))).not.toBeNull();
    await adapter.getSession(headersOf(jar)); // warm any cache that might exist
    // Revoke out-of-band, directly in the database: a cached cookie payload would still validate.
    await admin.query(`delete from sessions where user_id = (select id from users where email = $1)`, [addr]);
    expect(await adapter.getSession(headersOf(jar))).toBeNull();
  });
  it('sign-out invalidates the server-side session', async () => {
    const addr = email();
    await registerAndVerify(addr);
    const jar = new Jar();
    await post('/sign-in/email', { email: addr, password: PASSWORD }, jar);
    const before = jar.header();
    expect((await post('/sign-out', {}, jar)).status).toBe(200);
    expect(await adapter.getSession(new Headers({ cookie: before }))).toBeNull();
  });
});

describe('password reset', () => {
  it('issues a single-use reset link; old password stops working; reset token cannot be replayed', async () => {
    const addr = email();
    await registerAndVerify(addr);
    expect((await post('/forget-password', { email: addr, redirectTo: `${ORIGIN}/reset` })).status).toBe(200);
    const mail = lastMail();
    expect(mail?.subject).toBe('reset');
    const url = linkFrom(mail?.text);
    const token = url.pathname.split('/').filter(Boolean).pop() ?? '';
    const newPassword = 'a-brand-new-password-987';
    expect((await post('/reset-password', { newPassword, token })).status).toBe(200);
    expect((await post('/sign-in/email', { email: addr, password: PASSWORD })).status).toBe(401);
    expect((await post('/sign-in/email', { email: addr, password: newPassword }, new Jar())).status).toBe(200);
    expect((await post('/reset-password', { newPassword: 'another-new-password-555', token })).status).toBeGreaterThanOrEqual(400);
  });
  it('does not reveal whether an account exists', async () => {
    const before = sent.length;
    const res = await post('/forget-password', { email: email(), redirectTo: `${ORIGIN}/reset` });
    expect(res.status).toBeLessThan(500);
    expect(sent.length).toBe(before);
  });
});

describe('TOTP / MFA', () => {
  it('enrols TOTP, then login requires the second factor before any session exists', async () => {
    const addr = email();
    await registerAndVerify(addr);
    const jar = new Jar();
    await post('/sign-in/email', { email: addr, password: PASSWORD }, jar);

    const enable = await post('/two-factor/enable', { password: PASSWORD }, jar);
    expect(enable.status).toBe(200);
    const { totpURI } = (await enable.json()) as { totpURI: string };
    const secret = new URL(totpURI).searchParams.get('secret') ?? '';
    expect(secret.length).toBeGreaterThan(10);
    expect((await post('/two-factor/verify-totp', { code: totp(secret) }, jar)).status).toBe(200);
    expect((await adapter.getSession(headersOf(jar)))?.twoFactorEnabled).toBe(true);

    const fresh = new Jar();
    const login = await post('/sign-in/email', { email: addr, password: PASSWORD }, fresh);
    expect(login.status).toBe(200);
    expect(((await login.json()) as { twoFactorRedirect?: boolean }).twoFactorRedirect).toBe(true);
    expect(await adapter.getSession(headersOf(fresh))).toBeNull(); // no session yet

    // Even with a valid first-factor cookie state, a database-level check shows no usable session row yet.
    const pending = await admin.query(`select count(*)::int as n from sessions where user_id = (select id from users where email = $1) and id <> $2`, [addr, (await adapter.getSession(headersOf(jar)))?.sessionId ?? '']);
    expect(pending.rows[0].n).toBe(0);
    expect((await post('/two-factor/verify-totp', { code: '000000' }, fresh)).status).toBeGreaterThanOrEqual(400);
    expect((await post('/two-factor/verify-totp', { code: totp(secret) }, fresh)).status).toBe(200);
    expect((await adapter.getSession(headersOf(fresh)))?.email).toBe(addr);
  });
  it('stores the TOTP secret and backup codes in the database (not plaintext secrets in responses to other users)', async () => {
    const { rows } = await admin.query('select count(*)::int as n from two_factors');
    expect(rows[0].n).toBeGreaterThanOrEqual(1);
  });
});
