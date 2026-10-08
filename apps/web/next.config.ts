import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

const config: NextConfig = {
  // Workspace packages are consumed as TypeScript source.
  transpilePackages: [
    '@bnlinkvault/api',
    '@bnlinkvault/auth',
    '@bnlinkvault/config',
    '@bnlinkvault/contracts',
    '@bnlinkvault/core',
    '@bnlinkvault/db',
    '@bnlinkvault/i18n',
  ],
  // Native / server-only modules must not be bundled.
  serverExternalPackages: ['pg', '@node-rs/argon2'],
  poweredByHeader: false,
  reactStrictMode: true,
  // Never expose server env to the browser through next.config `env`.
};

export default withSentryConfig(config, {
  silent: true,
  // Source-map upload requires SENTRY_AUTH_TOKEN at build time (CI secret); skipped when unset.
  telemetry: false,
});
