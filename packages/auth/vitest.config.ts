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
          testTimeout: 60_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      // Security-critical modules: authorization policy and CSRF. Thresholds are enforced in CI.
      include: ['src/policy/**/*.ts', 'src/csrf.ts'],
      thresholds: { branches: 100, functions: 100, lines: 100, statements: 100 },
    },
  },
});
