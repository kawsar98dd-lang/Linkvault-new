# Local setup (requires network; Node 22, pnpm 10, PostgreSQL 15+)

1. `corepack enable && pnpm install` (a committed `pnpm-lock.yaml` is required; see dependency-pinning).
2. Start PostgreSQL and create an empty database, e.g. `createdb bnlinkvault`.
3. `cp .env.example .env` and fill values. Generate secrets: `openssl rand -base64 48` (distinct for
   `BETTER_AUTH_SECRET` and `CSRF_SECRET`).
4. Provision roles (admin credentials, once): `pnpm db:provision`.
5. Migrate (as `app_migrator`): `pnpm db:migrate`.
6. Run: `pnpm --filter @bnlinkvault/web dev`. Without `POSTMARK_SERVER_TOKEN`, a dev-only console mailer
   prints verification/reset/invitation links to stdout (it refuses to start in production).
7. Tests: `pnpm test:unit`; integration tests need `TEST_ADMIN_DATABASE_URL` (a superuser URL to a
   throwaway server): `pnpm --filter @bnlinkvault/db test:integration` (they DROP/CREATE `bnlinkvault_it`).
   Integration tests FAIL, never skip, when PostgreSQL is not configured.
8. Static checks without installing anything: `pnpm check:boundaries check:routes check:secrets check:scripts`
   (plain Node).

## Environment variables
| name | scope | notes |
|---|---|---|
| `APP_URL` | server | https in production |
| `TRUSTED_ORIGINS` | server | extra exact origins, comma separated |
| `DATABASE_URL` | server (runtime) | `app_rw` URL |
| `MIGRATOR_DATABASE_URL`, `ADMIN_DATABASE_URL`, `APP_RW_PASSWORD`, `APP_MIGRATOR_PASSWORD` | ops/CI only | never deploy to runtime |
| `BETTER_AUTH_SECRET`, `CSRF_SECRET` | server | >= 32 chars, different |
| `GOOGLE_CLIENT_ID/SECRET` | server | both or neither |
| `TURNSTILE_MODE` (`off|on|risk`), `TURNSTILE_SECRET_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | server/public | |
| `POSTMARK_SERVER_TOKEN`, `EMAIL_FROM` | server | token required in production |
| `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | server/public | optional; telemetry inactive when unset |
| `LOG_LEVEL` | server | debug/info/warn/error |

Validation: `packages/config/src/env.ts` (fails fast; never echoes values).

## Deployment (Phase 2)
Any Node 22 host or Vercel-compatible platform: run `pnpm db:provision` once and `pnpm db:migrate` on every
release (as `app_migrator`, from CI), deploy with the runtime `DATABASE_URL` (`app_rw`) only. Gate traffic on
`/readyz`. Production hosting choice (spec U1) and the distributed rate limiter remain open.
