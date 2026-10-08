# Security headers and CSP

Set in `apps/web/src/middleware.ts` using `src/lib/security-headers.ts` (unit tested).

| header | value |
|---|---|
| Content-Security-Policy-**Report-Only** | nonce + `strict-dynamic`, `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`, `form-action 'self'`, `report-uri /api/csp-report` |
| Strict-Transport-Security | production only: 2 years, includeSubDomains, preload |
| X-Content-Type-Options / X-Frame-Options | `nosniff` / `DENY` |
| Referrer-Policy | `strict-origin-when-cross-origin` |
| Permissions-Policy | camera, microphone, geolocation, payment, usb, interest-cohort disabled |
| COOP / CORP | `same-origin` / `same-origin` |
| API responses | `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` |

Intentional exceptions: CSP is Report-Only in Phase 2 (architecture spec §12.4); development adds
`'unsafe-eval'`/`'unsafe-inline'` for the Next.js dev server only. `X-XSS-Protection` is intentionally omitted
(obsolete). Moving to enforcing CSP requires reviewing reports from a real deployment first.
