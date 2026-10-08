import { createHash } from 'node:crypto';

export interface RateRule {
  readonly name: string;
  readonly limit: number;
  readonly windowSec: number;
}

export interface RateResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSec: number;
}

/** Vendor-neutral limiter port. Production implementations are distributed (edge KV/DO/Redis). */
export interface RateLimiter {
  consume(rule: RateRule, key: string): Promise<RateResult>;
}

/** Rules for authentication-sensitive endpoints (values are starting points, tune with data). */
export const AUTH_RATE_RULES = {
  signIn: { name: 'auth.sign_in', limit: 10, windowSec: 300 },
  signUp: { name: 'auth.sign_up', limit: 5, windowSec: 3600 },
  passwordReset: { name: 'auth.password_reset', limit: 5, windowSec: 3600 },
  emailVerification: { name: 'auth.email_verification', limit: 5, windowSec: 3600 },
  twoFactor: { name: 'auth.two_factor', limit: 10, windowSec: 300 },
  authOther: { name: 'auth.other', limit: 60, windowSec: 60 },
} as const satisfies Record<string, RateRule>;

export const API_RATE_RULES = {
  global: { name: 'api.global', limit: 300, windowSec: 60 },
  mutation: { name: 'api.mutation', limit: 60, windowSec: 60 },
} as const satisfies Record<string, RateRule>;

/** Hashes key parts so raw emails/IPs are not stored by limiter backends. */
export function rateKey(...parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\u001f')).digest('base64url').slice(0, 32);
}

/**
 * Single-process fixed-window limiter. FOR DEVELOPMENT AND TESTS ONLY: it is not shared between
 * instances, so it MUST NOT be the production limiter (see docs/security/rate-limiting.md).
 */
export class InMemoryRateLimiter implements RateLimiter {
  readonly distributed = false;
  private readonly windows = new Map<string, { resetAt: number; count: number }>();
  private readonly nowMs: () => number;
  private readonly maxKeys: number;

  constructor(nowMs: () => number = () => Date.now(), maxKeys = 50_000) {
    this.nowMs = nowMs;
    this.maxKeys = maxKeys;
  }

  consume(rule: RateRule, key: string): Promise<RateResult> {
    const now = this.nowMs();
    const id = `${rule.name}:${key}`;
    if (this.windows.size >= this.maxKeys) this.evictExpired(now);
    let w = this.windows.get(id);
    if (!w || w.resetAt <= now) {
      w = { resetAt: now + rule.windowSec * 1000, count: 0 };
      this.windows.set(id, w);
    }
    w.count += 1;
    const allowed = w.count <= rule.limit;
    return Promise.resolve({
      allowed,
      limit: rule.limit,
      remaining: Math.max(0, rule.limit - w.count),
      retryAfterSec: allowed ? 0 : Math.ceil((w.resetAt - now) / 1000),
    });
  }

  private evictExpired(now: number): void {
    for (const [k, v] of this.windows) if (v.resetAt <= now) this.windows.delete(k);
    if (this.windows.size >= this.maxKeys) this.windows.clear(); // fail open on memory pressure, never grow unbounded
  }
}

/** Client IP from trusted proxy headers. Returns 'unknown' (shared bucket) when none is present. */
export function clientIp(headers: Headers, order: readonly string[] = ['cf-connecting-ip', 'x-real-ip', 'x-forwarded-for']): string {
  for (const name of order) {
    const raw = headers.get(name);
    if (!raw) continue;
    const first = (name === 'x-forwarded-for' ? raw.split(',').pop() : raw)?.trim();
    if (first && first.length <= 64) return first;
  }
  return 'unknown';
}
