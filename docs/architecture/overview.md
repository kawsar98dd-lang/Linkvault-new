# Architecture overview (Phase 2)

Implements *Architecture Specification v1.0* §6/§8–§12 for the **control plane only**. The data plane
(edge redirect, gateway, analytics) is Phase 3+.

## Request flow
```
Browser ─▶ Next.js (apps/web)
            ├─ middleware.ts: security headers + CSP (Report-Only) + nonce
            ├─ /api/auth/*  ─▶ guardAuthRequest (rate limit, Turnstile hook) ─▶ AuthPort ─▶ Better Auth
            ├─ /api/v1/*    ─▶ Hono app (packages/api)
            │      requestId → accessLog → rateLimit(ip) → authenticate → rateLimit(user)
            │      → CSRF → resolveTenant → authorize(can, coarse) → idempotency → zod validation
            │      → handler → core service ─▶ withTenant ─▶ PostgreSQL (RLS)
            └─ /healthz, /readyz
```

## Implemented vs. verified
Everything above is **implemented**. Nothing has been **verified by execution** except the
dependency-free pieces listed in `PHASE-2-VERIFICATION-STATUS.md`.

## Package dependency rules (enforced by `scripts/check-boundaries.mjs`, run in CI)
| package | may depend on (production) |
|---|---|
| config, contracts, i18n | — |
| db | contracts |
| auth | contracts, db |
| core | auth, contracts, db, i18n |
| api | auth, contracts, core, i18n |
| testing | auth |
| web | api, auth, config, contracts, core, db, i18n |

Additional rules: Better Auth only inside `packages/auth/src/better-auth/`; `pg`/`drizzle-orm` only in
`db`/`core`; web frameworks only in `web`/`api`; UI files (`*.tsx`, `components/`) cannot import
infrastructure; no `localStorage`/`sessionStorage` in `apps/web/src`; no cycles; no undeclared or deep
imports. The script is self-tested (`scripts/__tests__/boundaries.test.mjs`).

## Composition root
`apps/web/src/server/container.ts` is the only file that wires concrete adapters. It is lazy, so
`next build` needs no runtime secrets.
