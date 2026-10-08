# Session cookie cache and 2FA: configuration analysis

Context: a critical Better Auth advisory (per the supplied research: versions below 1.4.9) concerns 2FA being
bypassed through session/cookie caching. This repository must not depend on a cached session payload for either
session validity or the "second factor completed" state.

## What this repository configures (`packages/auth/src/better-auth/create-auth.ts`)
- `session.cookieCache: { enabled: false }` — **explicit**, so a future default change in the library cannot enable it.
- no `secondaryStorage` (no cache layer for sessions);
- `emailAndPassword.requireEmailVerification: true`, `autoSignIn: false`;
- `twoFactor()` plugin; the login response for a 2FA user is `twoFactorRedirect` and **no session row is created
  until the second factor is verified**;
- `AuthPort.getSession` calls the provider on every request and zod-parses the result (unknown shape => anonymous).

## Why this is safe against that class of issue (reasoning, not proof)
With the cookie cache disabled, each request resolves the session from the database. Revoking a session (or never
creating one before the TOTP step) takes effect immediately, so a stale or crafted cookie payload cannot grant access.

## Guards (all in the repository)
| guard | what it checks | status |
|---|---|---|
| `scripts/__tests__/auth-config.test.mjs` | `cookieCache` is disabled, never enabled anywhere else, no `secondaryStorage` | **executed: pass** |
| `scripts/check-better-auth-advisory.mjs` | version floor 1.4.9 + OSV for the exact pinned version, fail closed | executed: fails closed on the UNRESOLVED pin; OSV part NOT RUN (no network) |
| `better-auth.int.test.ts` "sessions are resolved from the database…" | deleting the session row out-of-band invalidates the cookie immediately | NOT RUN (needs PostgreSQL + dependencies) |
| `better-auth.int.test.ts` TOTP test | no session row exists after password step until TOTP verified | NOT RUN |

## Limits of this analysis
The advisory text itself could not be read (no network). Whatever the selected newer version changes must be
re-validated by the integration tests above on the networked runner; do not enable `cookieCache` without re-running them.
