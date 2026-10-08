import { z } from 'zod';

const nonEmpty = z.string().trim().min(1);
const secret32 = z.string().min(32, 'must be at least 32 characters (use >= 32 random bytes)');
const optionalStr = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.trim()));

const serverShape = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.string().url(),
  TRUSTED_ORIGINS: optionalStr,
  DATABASE_URL: nonEmpty,
  BETTER_AUTH_SECRET: secret32,
  CSRF_SECRET: secret32,
  GOOGLE_CLIENT_ID: optionalStr,
  GOOGLE_CLIENT_SECRET: optionalStr,
  TURNSTILE_MODE: z.enum(['off', 'on', 'risk']).default('off'),
  TURNSTILE_SECRET_KEY: optionalStr,
  POSTMARK_SERVER_TOKEN: optionalStr,
  EMAIL_FROM: nonEmpty.default('BnlinkVault <no-reply@example.invalid>'),
  SENTRY_DSN: optionalStr,
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type ServerEnv = Omit<z.infer<typeof serverShape>, 'TRUSTED_ORIGINS'> & {
  TRUSTED_ORIGINS: string[];
};

/** Parses and cross-validates the server environment. Never echoes values (they may be secrets). */
export function loadServerEnv(source: Record<string, string | undefined> = process.env): ServerEnv {
  const parsed = serverShape.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid server environment:\n - ${issues.join('\n - ')}`);
  }
  const env = parsed.data;
  const problems: string[] = [];

  if (Boolean(env.GOOGLE_CLIENT_ID) !== Boolean(env.GOOGLE_CLIENT_SECRET)) {
    problems.push('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together');
  }
  if (env.TURNSTILE_MODE !== 'off' && !env.TURNSTILE_SECRET_KEY) {
    problems.push('TURNSTILE_SECRET_KEY is required when TURNSTILE_MODE is not "off"');
  }
  if (env.BETTER_AUTH_SECRET === env.CSRF_SECRET) {
    problems.push('BETTER_AUTH_SECRET and CSRF_SECRET must be different values');
  }
  if (env.NODE_ENV === 'production') {
    if (!env.APP_URL.startsWith('https://')) problems.push('APP_URL must be https in production');
    if (!env.POSTMARK_SERVER_TOKEN) problems.push('POSTMARK_SERVER_TOKEN is required in production');
  }

  const origins = (env.TRUSTED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const o of origins) {
    let u: URL;
    try {
      u = new URL(o);
    } catch {
      problems.push('TRUSTED_ORIGINS contains an invalid origin');
      continue;
    }
    if (u.origin !== o) problems.push('TRUSTED_ORIGINS entries must be exact origins (scheme://host[:port])');
  }
  if (problems.length > 0) throw new Error(`Invalid server environment:\n - ${problems.join('\n - ')}`);

  return { ...env, TRUSTED_ORIGINS: origins };
}

const publicShape = z.object({
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: optionalStr,
  NEXT_PUBLIC_SENTRY_DSN: optionalStr,
});
export type PublicEnv = z.infer<typeof publicShape>;

const FORBIDDEN_PUBLIC_NAME = /(SECRET|PASSWORD|PRIVATE|TOKEN|CREDENTIAL|DATABASE|SERVICE_KEY|API_KEY)/i;

/** Fails if any NEXT_PUBLIC_* variable name suggests a server secret would reach browser bundles. */
export function assertPublicEnvIsSafe(source: Record<string, string | undefined> = process.env): void {
  const bad = Object.keys(source).filter(
    (k) => k.startsWith('NEXT_PUBLIC_') && FORBIDDEN_PUBLIC_NAME.test(k),
  );
  if (bad.length > 0) {
    throw new Error(`Unsafe public env var name(s): ${bad.join(', ')} (NEXT_PUBLIC_* is shipped to browsers)`);
  }
}

export function loadPublicEnv(source: Record<string, string | undefined> = process.env): PublicEnv {
  assertPublicEnvIsSafe(source);
  return publicShape.parse(source);
}
