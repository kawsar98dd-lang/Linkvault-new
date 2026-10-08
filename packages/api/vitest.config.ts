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
    coverage: { provider: 'v8', include: ['src/registry.ts', 'src/middleware/*.ts', 'src/auth-guard.ts'] },
  },
});
