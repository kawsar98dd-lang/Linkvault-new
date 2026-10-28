# Dependency pinning

All third-party versions are exact pins in `pnpm-workspace.yaml` (`catalog:`); `.npmrc` sets `save-exact`.
CI forbids `latest`/ranges (job `security`, also covered by `scripts/__tests__/workflows.test.mjs`).

## Better Auth — deliberately UNRESOLVED in this repository
The earlier pin `better-auth: 1.2.7` was **removed**: per the security research supplied for this project,
versions below **1.4.9** are affected by a critical 2FA / session-caching vulnerability (this claim has not been
independently re-verified here: no registry/advisory access). The catalog entry is now `0.0.0-UNRESOLVED`, so:

- `pnpm install` fails closed (no such version) until the pin is resolved;
- `scripts/check-better-auth-advisory.mjs` fails closed (policy floor) even before any advisory lookup;
- no version was guessed offline.

Resolution happens on a networked runner in the `generate-lockfile` workflow:
`scripts/pin-better-auth.mjs` reads the npm registry, accepts the current `latest` dist-tag **only if** it is a plain
`MAJOR.MINOR.PATCH` version that exists, is not deprecated and is >= 1.4.9, queries OSV for that exact version,
refuses any critical/high/unknown-severity advisory, and writes the **exact** number (never `latest`) into the
catalog. The gate then runs again against the pinned value (and on every CI run).

Known risk: the Better Auth integration (`packages/auth/src/better-auth/*`, `better-auth.int.test.ts`) was written
against the 1.2.x API from memory. A 1.4+/newer release may rename options, plugin imports, endpoints or schema
fields; the integration tests and typecheck on the networked runner will show exactly what changed.

## Lockfile
None exists, and none is hand-written. The `generate-lockfile` workflow produces `pnpm-lock.yaml` (plus the verified
Better Auth pin and Prettier formatting) on the default branch after required checks pass. CI refuses to run without a lockfile
and always installs with `--frozen-lockfile`.

## Other pins
The remaining pins were chosen from model knowledge without registry access. If `pnpm install` reports a missing
version or peer mismatch, move that catalog entry to the nearest published patch; `pnpm audit --audit-level=high`
is a blocking CI gate. GitHub Actions are referenced by version tag (SHAs could not be resolved offline); Dependabot
keeps them current.

## Peer dependencies are strict (and stay strict)
`.npmrc` sets `strict-peer-dependencies=true` and `auto-install-peers=false`, so every REQUIRED peer must be declared by
the package that needs it. These flags are guarded by `scripts/__tests__/peer-deps.test.mjs`; bypass flags
(`--no-strict-peer-dependencies`, `--legacy-peer-deps`, `--force`) must never be added.

`webpack`: the first bootstrap run failed with `ERR_PNPM_PEER_DEP_ISSUES` because `@sentry/nextjs` →
`@sentry/webpack-plugin` has a required peer `webpack@>=4.40.0` that nothing provided. `apps/web` (the only consumer;
`next.config.ts` uses `withSentryConfig`) now declares `webpack` from the catalog (exact pin, single declaration point).
Next.js ships its own compiled webpack for builds; this declaration satisfies the package manager's peer contract and is
not used to compile the app. The pin was chosen without registry access; if the registry rejects it, move it to the
nearest published 5.x patch (any 5.x satisfies `>=4.40.0`) and re-run the bootstrap workflow.

Registry deprecation warnings for `eslint@9.24.0` and `next@15.3.0` are tracked separately and were NOT changed here:
read the exact deprecation text in the bootstrap log (it states the reason, e.g. a security advisory or end of support)
and upgrade deliberately, together with `pnpm audit` and the full CI run.
