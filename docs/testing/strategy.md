# Testing strategy

| layer | location | runs on |
|---|---|---|
| dependency-free checkers and static reviews (secrets, boundaries, Better Auth floor/pin logic, advisory parser, bundle scanner, `cookieCache` guard, workflow review) | `scripts/__tests__` | `node --test` (executed at authoring time) |
| pure unit tests (policy, CSRF, redaction, pagination, ids, rate limiter, i18n, env, headers) | `packages/*/test/*.test.ts` | Vitest |
| real-DB integration (roles, RLS, audit, invitations, schema parity, migrations, services) | `packages/db|core/test/*.int.test.ts` | Vitest + PostgreSQL |
| API security (CSRF, authz, IDOR matrix generated from the route registry, idempotency, pagination, rate limit, error contract) | `packages/api/test/api.int.test.ts` | Vitest + PostgreSQL |
| authentication (registration, verification, login, reset, sessions, revocation, TOTP) | `packages/auth/test/better-auth.int.test.ts` | real Better Auth + PostgreSQL |

Rules: integration tests FAIL (never skip) without PostgreSQL; no mocked RLS; the only fake is
`TestAuthPort` for API-layer tests (the real provider is covered by the auth integration test).
Coverage: 100% branch/function/line for `packages/auth/src/policy` and `csrf.ts` (enforced); ≥95% for selected
pure core modules. **Uncovered security-critical branches: unknown until CI runs** (coverage was not measured
at authoring time).

## Ad-hoc local execution at authoring time (NOT the CI runner)
A throw-away shim executed pure test files under Node's TypeScript stripping without Vitest. It is not part of
the repository and its results are informational only; see the verification status file.
