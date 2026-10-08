import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', include: ['test/**/*.test.ts'], exclude: ['test/**/*.int.test.ts'] } },
      {
        test: {
          name: 'integration',
          include: ['test/**/*.int.test.ts'],
          // Real PostgreSQL is mandatory; tests FAIL (never skip) when it is not configured.
          globalSetup: ['test/global-setup.ts'],
          fileParallelism: false,
          testTimeout: 30_000,
        },
      },
    ],
  },
});
