import {
  AUTH_RATE_RULES,
  AppError,
  captchaRequired,
  clientIp,
  rateKey,
  type CaptchaMode,
  type CaptchaVerifier,
  type RateLimiter,
  type RateRule,
  type Logger,
} from '@bnlinkvault/core';
import { problemFromRequest } from './middleware/core.ts';

export interface AuthGuardDeps {
  rateLimiter: RateLimiter;
  captcha: CaptchaVerifier;
  captchaMode: CaptchaMode;
  logger: Logger;
}

interface Classified {
  rule: RateRule;
  /** Challenge applies (when mode permits) to credential/e-mail-triggering endpoints. */
  challenge: boolean;
  action: string;
  keyedByEmail: boolean;
}

const MAP: readonly { match: RegExp; value: Classified }[] = [
  { match: /\/sign-in\/email$/, value: { rule: AUTH_RATE_RULES.signIn, challenge: true, action: 'sign_in', keyedByEmail: true } },
  { match: /\/sign-up\/email$/, value: { rule: AUTH_RATE_RULES.signUp, challenge: true, action: 'sign_up', keyedByEmail: true } },
  { match: /\/(forget-password|request-password-reset)$/, value: { rule: AUTH_RATE_RULES.passwordReset, challenge: true, action: 'password_reset', keyedByEmail: true } },
  { match: /\/reset-password$/, value: { rule: AUTH_RATE_RULES.passwordReset, challenge: false, action: 'password_reset', keyedByEmail: false } },
  { match: /\/send-verification-email$/, value: { rule: AUTH_RATE_RULES.emailVerification, challenge: true, action: 'email_verification', keyedByEmail: true } },
  { match: /\/two-factor\//, value: { rule: AUTH_RATE_RULES.twoFactor, challenge: false, action: 'two_factor', keyedByEmail: false } },
];
const DEFAULT: Classified = { rule: AUTH_RATE_RULES.authOther, challenge: false, action: 'auth_other', keyedByEmail: false };

export function classifyAuthRequest(pathname: string): Classified {
  return MAP.find((m) => m.match.test(pathname))?.value ?? DEFAULT;
}

async function emailFromBody(req: Request): Promise<string | null> {
  try {
    const body: unknown = await req.clone().json();
    const email = (body as { email?: unknown } | null)?.email;
    return typeof email === 'string' && email.length <= 254 ? email.trim().toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Guard in front of the Better Auth HTTP surface (/api/auth/*).
 * Returns a Response to short-circuit (429 / captcha_failed) or null to continue.
 * Order: IP bucket -> (account bucket) -> Turnstile when required by mode/risk.
 */
export async function guardAuthRequest(deps: AuthGuardDeps, req: Request, requestId: string): Promise<Response | null> {
  if (req.method === 'GET' || req.method === 'HEAD') {
    // Session reads, OAuth callbacks and e-mail verification links: coarse IP limit only.
    const r = await deps.rateLimiter.consume(AUTH_RATE_RULES.authOther, rateKey('auth-get', clientIp(req.headers)));
    return r.allowed ? null : fail(req, requestId, new AppError('rate_limited', { retryAfterSec: r.retryAfterSec }));
  }
  const url = new URL(req.url);
  const cls = classifyAuthRequest(url.pathname);
  const ip = clientIp(req.headers);

  const ipResult = await deps.rateLimiter.consume(cls.rule, rateKey('ip', ip));
  if (!ipResult.allowed) return fail(req, requestId, new AppError('rate_limited', { retryAfterSec: ipResult.retryAfterSec }));

  if (cls.keyedByEmail) {
    const email = await emailFromBody(req);
    if (email) {
      const acct = await deps.rateLimiter.consume(cls.rule, rateKey('acct', email));
      if (!acct.allowed) return fail(req, requestId, new AppError('rate_limited', { retryAfterSec: acct.retryAfterSec }));
    }
  }

  if (cls.challenge) {
    // "elevated" risk once more than half of the IP budget is spent.
    const risk = ipResult.remaining < Math.floor(ipResult.limit / 2) ? 'elevated' : 'low';
    if (captchaRequired(deps.captchaMode, risk)) {
      const ok = await deps.captcha.verify(req.headers.get('x-turnstile-token'), { ip, action: cls.action });
      if (!ok) {
        deps.logger.warn('captcha failed', { request_id: requestId, action: cls.action });
        return fail(req, requestId, new AppError('captcha_failed'));
      }
    }
  }
  return null;
}

function fail(req: Request, requestId: string, error: AppError): Response {
  return problemFromRequest(error, requestId, req);
}
