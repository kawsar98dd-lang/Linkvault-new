import { describe, expect, it } from 'vitest';
import { assertPublicEnvIsSafe, loadServerEnv } from '../src/env.ts';

const good = {
  NODE_ENV: 'test',
  APP_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgres://app_rw:x@localhost/db',
  BETTER_AUTH_SECRET: 'a'.repeat(40),
  CSRF_SECRET: 'b'.repeat(40),
};

describe('loadServerEnv', () => {
  it('accepts a minimal valid environment', () => {
    const env = loadServerEnv(good);
    expect(env.TURNSTILE_MODE).toBe('off');
    expect(env.TRUSTED_ORIGINS).toEqual([]);
  });
  it('rejects short secrets', () => {
    expect(() => loadServerEnv({ ...good, CSRF_SECRET: 'short' })).toThrow(/CSRF_SECRET/);
  });
  it('rejects identical auth and csrf secrets', () => {
    expect(() => loadServerEnv({ ...good, CSRF_SECRET: good.BETTER_AUTH_SECRET })).toThrow(/different/);
  });
  it('requires Google credentials together', () => {
    expect(() => loadServerEnv({ ...good, GOOGLE_CLIENT_ID: 'id' })).toThrow(/together/);
  });
  it('requires a Turnstile secret when enabled', () => {
    expect(() => loadServerEnv({ ...good, TURNSTILE_MODE: 'on' })).toThrow(/TURNSTILE_SECRET_KEY/);
  });
  it('enforces https and email provider in production', () => {
    expect(() => loadServerEnv({ ...good, NODE_ENV: 'production' })).toThrow(/https/);
  });
  it('validates trusted origins strictly', () => {
    expect(
      loadServerEnv({ ...good, TRUSTED_ORIGINS: 'https://a.example, https://b.example' }).TRUSTED_ORIGINS,
    ).toHaveLength(2);
    expect(() => loadServerEnv({ ...good, TRUSTED_ORIGINS: 'https://a.example/path' })).toThrow(/exact origins/);
    expect(() => loadServerEnv({ ...good, TRUSTED_ORIGINS: 'not a url' })).toThrow(/invalid origin/);
  });
});

describe('assertPublicEnvIsSafe', () => {
  it('allows safe public names', () => {
    expect(() => assertPublicEnvIsSafe({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'x' })).not.toThrow();
  });
  it('rejects secret-looking public names', () => {
    expect(() => assertPublicEnvIsSafe({ NEXT_PUBLIC_API_SECRET: 'x' })).toThrow(/Unsafe/);
    expect(() => assertPublicEnvIsSafe({ NEXT_PUBLIC_DATABASE_URL: 'x' })).toThrow(/Unsafe/);
  });
});
