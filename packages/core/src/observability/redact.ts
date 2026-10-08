const SENSITIVE_KEY =
  /(pass(word|phrase)?|secret|token|authorization|cookie|set-cookie|api[-_]?key|credential|csrf|otp|totp|backup[-_]?code|private[-_]?key|dsn|session|signature)/i;

const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const URL_CREDENTIALS = /([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi;

export const REDACTED = '[REDACTED]';
const MAX_DEPTH = 6;
const MAX_STRING = 2000;
const MAX_KEYS = 100;

export function redactString(s: string): string {
  const cut = s.length > MAX_STRING ? `${s.slice(0, MAX_STRING)}...[truncated]` : s;
  return cut.replace(BEARER, `$1 ${REDACTED}`).replace(JWT, REDACTED).replace(URL_CREDENTIALS, `$1${REDACTED}@`);
}

/** Deep, cycle-safe, size-bounded redaction for anything that may be logged or audited. */
export function redact(value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message) };
  }
  if (typeof value !== 'object') return undefined;
  if (depth >= MAX_DEPTH) return '[MaxDepth]';
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, MAX_KEYS).map((v) => redact(v, depth + 1, seen));
  const out: Record<string, unknown> = {};
  let n = 0;
  for (const [k, v] of Object.entries(value)) {
    if (n++ >= MAX_KEYS) {
      out['[truncated]'] = true;
      break;
    }
    out[k] = SENSITIVE_KEY.test(k) ? REDACTED : redact(v, depth + 1, seen);
  }
  return out;
}
