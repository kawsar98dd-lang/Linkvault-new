import 'server-only';
import { BetterAuthAdapter, createBetterAuth } from '@bnlinkvault/auth/better-auth';
import {
  ConsoleMailer,
  DisabledCaptchaVerifier,
  InMemoryRateLimiter,
  PostmarkMailer,
  TurnstileVerifier,
  createCoreServices,
  createLogger,
  noopTracer,
  type CaptchaVerifier,
  type Mailer,
} from '@bnlinkvault/core';
import { createApiApp, type ApiApp } from '@bnlinkvault/api';
import { createDatabase, createPool } from '@bnlinkvault/db';
import { isLocale, t } from '@bnlinkvault/i18n';
import { serverEnv } from './env.ts';

export interface Container {
  api: ApiApp;
  auth: BetterAuthAdapter;
  db: ReturnType<typeof createDatabase>;
  rateLimiter: InMemoryRateLimiter;
  captcha: CaptchaVerifier;
  captchaMode: 'off' | 'on' | 'risk';
  logger: ReturnType<typeof createLogger>;
}

let instance: Container | undefined;

/**
 * Composition root. The ONLY file that wires concrete adapters (Postgres, Better Auth, mail, captcha).
 * Lazily created on first request so `next build` does not require runtime secrets.
 */
export function container(): Container {
  if (instance) return instance;
  const env = serverEnv();
  const logger = createLogger({ level: env.LOG_LEVEL, base: { service: 'web' } });
  const pool = createPool({
    connectionString: env.DATABASE_URL,
    onError: (e) => {
      logger.error('pg pool error', { error: e });
    },
  });
  const db = createDatabase(pool);

  const mailer: Mailer = env.POSTMARK_SERVER_TOKEN
    ? new PostmarkMailer(env.POSTMARK_SERVER_TOKEN, env.EMAIL_FROM)
    : new ConsoleMailer(env.NODE_ENV);

  const betterAuth = createBetterAuth({
    db,
    baseURL: env.APP_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [new URL(env.APP_URL).origin, ...env.TRUSTED_ORIGINS],
    isProduction: env.NODE_ENV === 'production',
    google: env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } : undefined,
    sendEmail: (m) => mailer.send(m),
    emailTexts: {
      verify: ({ name, url }) => ({ subject: t('en', 'email.verify.subject'), text: t('en', 'email.verify.body', { name, url }) }),
      reset: ({ name, url }) => ({ subject: t('en', 'email.reset.subject'), text: t('en', 'email.reset.body', { name, url }) }),
    },
  });
  const auth = new BetterAuthAdapter(betterAuth);

  // KNOWN LIMITATION (docs/security/rate-limiting.md): the in-memory limiter is per-instance.
  // Replace with a distributed implementation of RateLimiter before multi-instance production use.
  const rateLimiter = new InMemoryRateLimiter();
  const captcha: CaptchaVerifier = env.TURNSTILE_SECRET_KEY ? new TurnstileVerifier(env.TURNSTILE_SECRET_KEY) : new DisabledCaptchaVerifier();

  const services = createCoreServices({ db, mailer, logger, appUrl: env.APP_URL });
  const api = createApiApp({
    services,
    auth,
    rateLimiter,
    captcha,
    captchaMode: env.TURNSTILE_MODE,
    logger,
    tracer: noopTracer,
    csrfSecret: env.CSRF_SECRET,
    allowedOrigins: [new URL(env.APP_URL).origin, ...env.TRUSTED_ORIGINS],
    isProduction: env.NODE_ENV === 'production',
  });

  void isLocale; // locale selection per user arrives with the dashboard phase
  instance = { api, auth, db, rateLimiter, captcha, captchaMode: env.TURNSTILE_MODE, logger };
  return instance;
}
