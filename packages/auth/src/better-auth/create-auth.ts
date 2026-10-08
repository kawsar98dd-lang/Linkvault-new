import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { twoFactor } from 'better-auth/plugins';
import { schema, type Database } from '@bnlinkvault/db';
import type { SendEmail } from '../port.ts';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, hashPassword, verifyPassword } from './password.ts';

export interface BetterAuthConfig {
  db: Database;
  baseURL: string;
  secret: string;
  trustedOrigins: readonly string[];
  isProduction: boolean;
  google?: { clientId: string; clientSecret: string } | undefined;
  sendEmail: SendEmail;
  /** Localised email builders are injected so this package has no dependency on i18n/core. */
  emailTexts: {
    verify(input: { name: string; url: string }): { subject: string; text: string };
    reset(input: { name: string; url: string }): { subject: string; text: string };
  };
}

const SESSION_TTL_SEC = 60 * 60 * 24 * 7;

/**
 * The ONLY place that configures Better Auth. Everything else uses the AuthPort.
 * Notes (see docs/authentication/overview.md):
 *  - Argon2id replaces the default scrypt hasher.
 *  - Email verification is mandatory before a session is issued.
 *  - Account linking is disabled (no implicit takeover by matching e-mail).
 *  - Better Auth's own rate limiter is OFF: rate limiting + Turnstile are applied by our
 *    RateLimiter/CaptchaVerifier ports in the route guard (packages/api/src/auth-guard.ts).
 */
export function createBetterAuth(config: BetterAuthConfig) {
  return betterAuth({
    appName: 'BnlinkVault',
    baseURL: config.baseURL,
    secret: config.secret,
    trustedOrigins: [...config.trustedOrigins],
    database: drizzleAdapter(config.db, {
      provider: 'pg',
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        twoFactor: schema.twoFactor,
      },
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      autoSignIn: false,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
      password: { hash: hashPassword, verify: verifyPassword },
      sendResetPassword: async ({ user, url }) => {
        const m = config.emailTexts.reset({ name: user.name, url });
        await config.sendEmail({ to: user.email, subject: m.subject, text: m.text });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, url }) => {
        const m = config.emailTexts.verify({ name: user.name, url });
        await config.sendEmail({ to: user.email, subject: m.subject, text: m.text });
      },
    },
    socialProviders: config.google
      ? { google: { clientId: config.google.clientId, clientSecret: config.google.clientSecret } }
      : {},
    account: { accountLinking: { enabled: false } },
    session: {
      expiresIn: SESSION_TTL_SEC,
      updateAge: 60 * 60 * 24,
      freshAge: 60 * 15,
      // SECURITY: the signed session cookie cache MUST stay disabled. Every request resolves the session
      // from the database, so revocation and the "no session before the second factor" guarantee do not
      // depend on a cached cookie payload (see docs/authentication/session-cache-analysis.md and the
      // scripts/__tests__/auth-config.test.mjs guard). Do not enable without re-running the 2FA tests.
      cookieCache: { enabled: false },
    },
    rateLimit: { enabled: false },
    advanced: {
      cookiePrefix: 'bnlv',
      useSecureCookies: config.isProduction,
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', secure: config.isProduction, path: '/' },
    },
    plugins: [twoFactor({ issuer: 'BnlinkVault' })],
  });
}

export type BetterAuthInstance = ReturnType<typeof createBetterAuth>;
