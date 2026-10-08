# Phase 2 implementation records (ADR addenda to Architecture Spec v1.0)

**IR-001 AuthPort + Better Auth.** Better Auth lives only in `packages/auth/src/better-auth/` (boundary-enforced).
Gate: advisory check in CI (not run at authoring time). Fallback per ADR-003: Clerk/WorkOS behind the same port.

**IR-002 Hand-written SQL migrations + custom runner instead of drizzle-kit journals.** RLS, roles, triggers and
definer functions are SQL-first; Drizzle is the typed query layer. Parity test guards drift. Runner: advisory lock,
per-migration transaction, checksum drift detection.

**IR-003 UUID v4 + public ids.** `gen_random_uuid()` and `ws_…` random public ids; revisit UUIDv7 on PostgreSQL 18.

**IR-004 Audit through a definer function.** `app_rw` cannot touch `audit_logs`; keeps role separation while staying
transactional. Function also verifies actor, bound workspace and membership.

**IR-005 Single audited RLS exception for invitation acceptance** (`app.accept_invitation`).

**IR-006 `contracts/domain` pure subpath** so the authorization package depends on vocabulary only.

**IR-007 Erasable-syntax TypeScript** (`erasableSyntaxOnly`): no enums/parameter properties; lets Node run DB CLIs
without a build step.

**IR-008 Deviations from spec v1.0:** `audit_logs` not partitioned; auth tables not under RLS and readable by `app_rw`;
in-memory rate limiter only; Hono mounted in Next route handlers via `hono/vercel`.
