import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id parameters follow the OWASP minimum recommendation (m=19 MiB, t=2, p=1).
 * `algorithm: 2` is Argon2id in @node-rs/argon2 (numeric literal used because `Algorithm` is a
 * const enum, which is incompatible with isolatedModules).
 */
export const ARGON2ID_OPTIONS = { algorithm: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2ID_OPTIONS);
}

export async function verifyPassword(input: { hash: string; password: string }): Promise<boolean> {
  try {
    return await verify(input.hash, input.password);
  } catch {
    return false; // malformed hash must never throw into the auth flow
  }
}
