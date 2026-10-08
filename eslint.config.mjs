// Root flat config. Layer 1: strict TypeScript preset. Layer 2: import restrictions mirroring
// scripts/lib/boundaries.mjs (the CI-authoritative checker). Both must pass.
import { base } from '@bnlinkvault/config/eslint';

const restrict = (patterns, message) => ({
  'no-restricted-imports': ['error', { patterns: patterns.map((group) => ({ group: [group], message })) }],
});

export default [
  { ignores: ['**/node_modules/**', '**/.next/**', '**/dist/**', '**/coverage/**', '**/*.mjs', '**/next-env.d.ts', '**/*.config.ts', '**/*.config.mjs'] },
  ...base.map((c) => ({ ...c, files: ['**/*.ts', '**/*.tsx'] })),
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
  },
  {
    files: ['packages/core/**/*.ts', 'packages/db/**/*.ts', 'packages/auth/**/*.ts', 'packages/contracts/**/*.ts', 'packages/i18n/**/*.ts'],
    rules: restrict(['next', 'next/*', 'react', 'react-dom', 'hono', 'hono/*', '@hono/*'], 'Domain/infrastructure packages must not depend on web frameworks'),
  },
  {
    files: ['packages/core/**/*.ts', 'packages/api/**/*.ts', 'packages/db/**/*.ts', 'apps/web/**/*.ts', 'apps/web/**/*.tsx'],
    ignores: ['packages/auth/src/better-auth/**', 'packages/auth/test/**'],
    rules: restrict(['better-auth', 'better-auth/*', '@node-rs/argon2'], 'Use the AuthPort; Better Auth is confined to packages/auth/src/better-auth'),
  },
  {
    files: ['apps/web/**/*.tsx', 'apps/web/src/components/**/*.ts'],
    rules: restrict(['@bnlinkvault/db', '@bnlinkvault/db/*', '@bnlinkvault/core', '@bnlinkvault/core/*', 'pg', 'drizzle-orm', 'drizzle-orm/*'], 'UI code must not import infrastructure'),
  },
  {
    files: ['apps/web/src/**/*.ts', 'apps/web/src/**/*.tsx'],
    rules: { 'no-restricted-globals': ['error', { name: 'localStorage', message: 'No authoritative state in browser storage' }, { name: 'sessionStorage', message: 'No authoritative state in browser storage' }] },
  },
  {
    files: ['**/test/**/*.ts', '**/*.test.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off', '@typescript-eslint/no-unsafe-assignment': 'off', '@typescript-eslint/no-unsafe-member-access': 'off', '@typescript-eslint/no-unsafe-argument': 'off', '@typescript-eslint/no-floating-promises': 'off', '@typescript-eslint/require-await': 'off', '@typescript-eslint/no-confusing-void-expression': 'off' },
  },
];
