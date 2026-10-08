# Observability

- **Structured logs**: `packages/core/src/observability/logger.ts` (JSON; level; child loggers; every field
  deep-redacted: passwords, tokens, cookies, authorization, API keys, Bearer/JWT/URL credentials).
  Access log fields: request id, method, route, status, duration, actor id, workspace public id.
- **Request ids**: accepted only if `[A-Za-z0-9_-]{8,64}`, otherwise generated; echoed as `x-request-id` and in problems.
- **Sentry**: `apps/web/src/instrumentation.ts` initialises **only if `SENTRY_DSN` is set**; strips cookies/headers.
  Exit criterion 12 is checked by `pnpm sentry:test` (exit 2 = not configured, never success).
- **OpenTelemetry**: foundation only. `Tracer` port + `noopTracer`; `tracingStatus()` reports `inactive`
  honestly. Sentry v9 provides OTel-based tracing when enabled; no other exporters are configured.
- Not external-verified: no telemetry backend was reachable at authoring time.
