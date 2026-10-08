import { describe, expect, it } from 'vitest';
import { ARGON2ID_OPTIONS, hashPassword, verifyPassword } from '../src/better-auth/password.ts';

// Requires the native @node-rs/argon2 binary (installed by pnpm in CI).
describe('Argon2id password hashing', () => {
  it('uses Argon2id with OWASP-minimum parameters and verifies correctly', async () => {
    const h = await hashPassword('correct horse battery staple');
    expect(h.startsWith('$argon2id$')).toBe(true);
    expect(ARGON2ID_OPTIONS).toMatchObject({ memoryCost: 19_456, timeCost: 2, parallelism: 1 });
    expect(await verifyPassword({ hash: h, password: 'correct horse battery staple' })).toBe(true);
    expect(await verifyPassword({ hash: h, password: 'wrong password!!' })).toBe(false);
  });
  it('never throws on malformed hashes', async () => {
    expect(await verifyPassword({ hash: 'not-a-hash', password: 'whatever-password' })).toBe(false);
  });
  it('salts: same password hashes differently', async () => {
    expect(await hashPassword('same-password-123')).not.toBe(await hashPassword('same-password-123'));
  });
});
