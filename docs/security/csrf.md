# CSRF

Cookie-authenticated, state-changing `/api/v1` requests must pass **both**:
1. Origin check: `Origin` must be an allowed origin; if absent, `Sec-Fetch-Site` must be `same-origin`/`none`
   (`cross-site`/`same-site`/missing => rejected).
2. A signed token bound to the session: `GET /api/v1/csrf` returns `nonce.HMAC(secret, "v1.<sessionId>.<nonce>")`,
   sent back as `X-CSRF-Token`. Keep it in memory only (never browser storage).

SameSite=Lax cookies are defence in depth only. Tests: `packages/auth/test/csrf.test.ts` (100% branch target)
and `packages/api/test/api.int.test.ts` (valid, missing, invalid, cross-origin, other-session token).
Better Auth's own endpoints rely on its trusted-origin check plus our guard.
