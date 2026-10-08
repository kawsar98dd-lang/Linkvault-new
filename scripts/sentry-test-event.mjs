#!/usr/bin/env node
// Sends one test event to the configured Sentry project (Phase 2 exit criterion #12).
// Exit 2 = Sentry not configured (never reported as success).
const dsn = process.env.SENTRY_DSN;
if (!dsn) {
  process.stderr.write('SENTRY_DSN is not set: NOT RUN\n');
  process.exit(2);
}
const Sentry = await import('@sentry/node');
Sentry.init({ dsn, environment: process.env.NODE_ENV ?? 'ci', sendDefaultPii: false });
const id = Sentry.captureMessage('BnlinkVault Phase 2 Sentry test event', 'info');
const flushed = await Sentry.flush(10_000);
process.stdout.write(`sentry event ${id} flushed=${flushed}\n`);
process.exit(flushed ? 0 : 1);
