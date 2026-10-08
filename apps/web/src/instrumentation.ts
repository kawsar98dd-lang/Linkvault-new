/**
 * Sentry/OpenTelemetry bootstrap. Sentry initialises ONLY when SENTRY_DSN is set; otherwise telemetry
 * is reported as inactive (see docs/development/observability.md). Sentry v9 supplies the OTel
 * tracing pipeline; additional exporters are intentionally not configured in Phase 2.
 */
export async function register(): Promise<void> {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  const Sentry = await import('@sentry/nextjs');
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
    beforeSend(event) {
      // Strip request cookies/headers defensively; auth state must never reach Sentry.
      if (event.request) {
        delete event.request.cookies;
        delete event.request.headers;
      }
      return event;
    },
  });
}

export async function onRequestError(...args: unknown[]): Promise<void> {
  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import('@sentry/nextjs');
  const handler = Sentry.captureRequestError as unknown as (...a: unknown[]) => void;
  handler(...args);
}
