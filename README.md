# BnlinkVault — Phase 2: Secure Platform Foundation

> **STATUS: PHASE 2 IMPLEMENTED — UNVERIFIED.**
> This codebase was authored in an environment with no network, no PostgreSQL, no Docker and no
> `pnpm`. Nothing that requires those has been executed. See
> [`PHASE-2-VERIFICATION-STATUS.md`](PHASE-2-VERIFICATION-STATUS.md) for exactly what ran and what did not.
> Phase 3 must not start until the GitHub Actions workflow is green.

BnlinkVault is being rebuilt as a Smart Link Management & Monetization platform. The previous static
"link locker" is **legacy and not part of this codebase** (see `docs/security/legacy-sunset.md`).

## What exists in Phase 2
Monorepo (pnpm + Turborepo), Next.js shell (`/healthz`, `/readyz`), PostgreSQL schema with Row Level
Security, tenant context (`withTenant`), Better Auth behind `AuthPort` (email/password with Argon2id,
verification, reset, Google OAuth foundation, TOTP, session list/revoke), workspaces, memberships,
invitations, owner transfer, central `can()` authorization with a route registry, Hono `/api/v1`
(Zod, OpenAPI, Problem+JSON, cursor pagination, idempotency, request ids, rate-limit port), audit log,
outbox, structured logging with redaction, Sentry/OpenTelemetry foundations, security headers,
CSP report-only, CSRF, secret scanning, browser-bundle secret scanning, CI.

## What does NOT exist (by design)
Links, redirects, gateways, analytics, custom domains, billing, dashboards UI, legacy-link migration.

## Layout
```
apps/web            Next.js shell + route handlers (composition root: src/server/container.ts)
packages/config     tsconfig/eslint presets, validated environment schema
packages/contracts  zod schemas + pure domain vocabulary (roles, actions, error codes)
packages/db         Drizzle schema, SQL migrations (RLS, roles), withTenant, migrator, readiness
packages/auth       AuthPort, can()/permission matrix, CSRF, Better Auth adapter (confined)
packages/core       domain services, audit, outbox, idempotency, logging, rate-limit/captcha ports
packages/api        Hono app, declareRoute() + registry, middleware, auth guard
packages/i18n       en + bn (skeleton) catalogs
packages/testing    test doubles (TestAuthPort)
scripts/            dependency-free security/architecture checkers (+ self tests)
docs/               architecture, security, database, authentication, testing, development, adr
```

## Quick start (needs network, Node 22, pnpm 10)
```
corepack enable && pnpm install
cp .env.example .env            # fill secrets (openssl rand -base64 48)
pnpm db:provision && pnpm db:migrate
pnpm --filter @bnlinkvault/web dev
```
See `docs/development/local-setup.md`. **Before anything installs:** run the `generate-lockfile` workflow once. It
resolves and verifies the Better Auth pin (currently `0.0.0-UNRESOLVED`: 1.2.7 was removed as vulnerable), generates
`pnpm-lock.yaml`, applies Prettier and reports real `tsc`/ESLint output (see
`docs/development/dependency-pinning.md`).
