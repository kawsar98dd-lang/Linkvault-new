# Authentication (implemented; NOT verified)

`AuthPort` (`packages/auth/src/port.ts`) is the only surface the platform uses. Better Auth is confined to
`packages/auth/src/better-auth/` and its outputs are zod-parsed at the boundary; session **tokens never
leave** the adapter (APIs expose session ids only).

| capability | implementation |
|---|---|
| e-mail/password | Better Auth; **Argon2id** (m=19 MiB, t=2, p=1) via `@node-rs/argon2`; min 12 chars |
| verification | mandatory (`requireEmailVerification`), no auto sign-in |
| reset | Better Auth `sendResetPassword`; token single use (tested in `better-auth.int.test.ts`) |
| Google OAuth | configured when both env vars are set; **no live test** (needs real credentials) |
| TOTP | Better Auth `twoFactor` plugin; login returns `twoFactorRedirect`, no session before 2nd factor |
| sessions | server-side rows; cookie `bnlv.*` HttpOnly, SameSite=Lax, Secure in production; list/revoke by id |
| CSRF | `/api/v1`: Origin/Fetch-Metadata + session-bound HMAC token (`X-CSRF-Token`); Better Auth also checks trusted origins |
| rate limit / Turnstile | `guardAuthRequest` in front of `/api/auth/*` (IP + account buckets; challenge by mode/risk) |
| account linking | disabled (no implicit takeover by e-mail match) |

## Version gate
`better-auth` is **UNRESOLVED on purpose** (`0.0.0-UNRESOLVED`): the previous pin 1.2.7 is below the 1.4.9 security
floor. The exact current stable version is resolved and verified by the networked `generate-lockfile` workflow
(`scripts/pin-better-auth.mjs`), then guarded on every CI run by `scripts/check-better-auth-advisory.mjs`
(version floor + OSV for the exact pinned version). The gate FAILS on critical/high/unknown-severity advisories,
on a pin below the floor, on a non-exact pin, and when verification is impossible. **Security-advisory verification:
NOT RUN — network unavailable.** See `docs/development/dependency-pinning.md` and `session-cache-analysis.md`
(`session.cookieCache` is explicitly disabled and guarded by a test).

## Not implemented
Passkeys (Phase 2b/3), auth-event audit entries (sign-in/failed sign-in are not yet written to
`audit_logs`), invitation-accept UI page (the e-mail link targets `/invitations/accept#token=…`; the page
arrives with the dashboard phase).
