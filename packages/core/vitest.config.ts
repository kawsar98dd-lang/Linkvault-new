import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', include: ['test/**/*.test.ts'], exclude: ['test/**/*.int.test.ts'] } },
      {
        test: {
          name: 'integration',
          include: ['test/**/*.int.test.ts'],
          globalSetup: ['../db/test/global-setup.ts'],
          fileParallelism: false,
          testTimeout: 30_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/errors.ts', 'src/problem.ts', 'src/pagination.ts', 'src/idempotency/fingerprint.ts', 'src/observability/redact.ts', 'src/security/rate-limit.ts', 'src/security/captcha.ts'],
      thresholds: { branches: 95, functions: 100, lines: 95, statements: 95 },
    },
  },
});
