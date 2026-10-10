import { createHash } from 'node:crypto';

/**
 * Deterministic JSON (sorted keys) so semantically equal bodies hash equally.
 * Input is `unknown`, so unsupported runtime values are handled explicitly instead of relying on
 * `JSON.stringify` quirks (it returns `undefined` for functions/symbols and throws on bigint):
 * `undefined` canonicalises to `null` (as before); function/symbol/bigint/non-finite numbers are rejected,
 * so they can never collide with a legitimate `null`. Parsed JSON request bodies never contain them.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonicalJson: non-finite number');
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') throw new TypeError(`canonicalJson: unsupported ${typeof value}`);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .filter((k) => obj[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(',')}}`;
}

export function requestFingerprint(method: string, path: string, body: unknown): string {
  return createHash('sha256').update(`${method.toUpperCase()}\n${path}\n${canonicalJson(body)}`).digest('hex');
}

export const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_\-.:]{8,128}$/;
