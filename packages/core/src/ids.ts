import { createHash, randomBytes } from 'node:crypto';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** `ws_` + 20 chars from a CSPRNG (rejection sampling avoids modulo bias). */
export function newWorkspacePublicId(): string {
  let out = '';
  while (out.length < 20) {
    for (const b of randomBytes(32)) {
      if (b < 252 && out.length < 20) out += ALPHABET[b % 36];
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
