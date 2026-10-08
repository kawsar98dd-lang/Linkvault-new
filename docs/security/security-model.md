# Security model (Phase 2)

**Implemented ≠ verified.** See `../../PHASE-2-VERIFICATION-STATUS.md`.

## Trust boundaries
Untrusted: every browser-supplied value (body, query, headers incl. `Host`/`X-Forwarded-*`, cookies).
Trusted: server code, database (via RLS-subject role), secrets in server environment.
No browser-visible master secret exists: `NEXT_PUBLIC_*` names are validated, `server-only` guards server
modules, and CI scans built browser bundles for server secret *values* and *names*.

## Layers
1. **Authentication**: sessions are server-side; no auth state in browser storage (lint + boundary rule).
2. **Authorization**: one `can()`; every route declares action/resource via `declareRoute()`; startup throws
   if a router entry is undeclared; `scripts/check-route-declarations.mjs` guards the source statically.
3. **Tenancy**: path-resolved membership (404 for non-members) + RLS in PostgreSQL (defence in depth).
4. **Input**: Zod on every body/query/param; unknown keys rejected on write bodies.
5. **Errors**: RFC 9457 problems; unknown errors never leak messages/stacks/SQL; cross-tenant == not found.
6. **Idempotency**: scope (actor, workspace, key) + request fingerprint; also enforced by RLS.
7. **Audit**: append-only through a definer function owned by a separate role; metadata redacted + size-limited.
8. **Logging**: JSON, deep redaction (keys and embedded Bearer/JWT/URL credentials), bounded sizes.

## Invitations
Raw token: 256-bit, only its SHA-256 stored, delivered **only** by e-mail (never API/log/audit/idempotency
store). Accept is a single locked DB function with uniform failure.

## Residual risks (documented, not hidden)
In-memory rate limiter (per instance); auth tables not under RLS; auth events not audited; CSP is
Report-Only; GitHub Actions pinned by tag, not SHA; versions pinned without registry access.
