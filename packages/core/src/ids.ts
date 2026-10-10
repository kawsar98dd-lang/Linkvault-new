import { createHash, randomBytes } from 'node:crypto';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const ID_LENGTH = 20;
/** Largest multiple of the alphabet size that fits in a byte: bytes >= LIMIT are rejected (no modulo bias). */
const REJECTION_LIMIT = 256 - (256 % ALPHABET.length);

/**
 * `ws_` + 20 chars from a CSPRNG. `charAt` is total (always a string) and, because every accepted byte
 * is < REJECTION_LIMIT, `b % ALPHABET.length` is always a valid index: the invariant is structural, not asserted.
 */
export function newWorkspacePublicId(): string {
  let out = '';
  while (out.length < ID_LENGTH) {
    for (const b of randomBytes(32)) {
      if (b < REJECTION_LIMIT && out.length < ID_LENGTH) out += ALPHABET.charAt(b % ALPHABET.length);
    }
  }
  return `ws_${out}`;
}

export const newUuid = (): string => crypto.randomUUID();

/** 256-bit opaque token for invitations. Only its SHA-256 is ever stored. */
export function newOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
