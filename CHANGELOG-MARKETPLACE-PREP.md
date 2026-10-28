# Change Log — Marketplace Preparation

## 0.2.1-prep (2026-10-23)

- Selected `Linkvault-new-chore-bootstrap` as the base because it contains the additional ZIP import workflow tests and API type diagnostic workflow.
- Added Bengali marketplace readiness roadmap and Android-only next-step guide.
- Added hosting compatibility notes for the current Next.js + PostgreSQL architecture.
- Updated README to state that the current package is not a complete sellable SaaS and is not verified for Cloudflare production deployment.
- Changed `generate-lockfile` workflow to use a normal push instead of force-push, so a divergent review branch fails safely rather than being overwritten.
- Preserved existing application source, authentication, database schema, API, security foundation, and CI checks.

## Verification limits

Dependency installation, actual `pnpm-lock.yaml` generation, full typecheck/lint/format, PostgreSQL integration/RLS tests, production build, and GitHub Actions remain unverified. See `PHASE-2-VERIFICATION-STATUS.md`. The full ZIP import workflow test exceeded the local test timeout and is not reported as passed.


## 0.2.2-prep (2026-10-28)

- Adapted the ZIP import instructions and workflow to use the repository default branch only, as requested.
- The importer validates the archive before extraction, uses normal push (never force-push), and removes only the uploaded ZIP after a successful apply; it does not delete other project files.
- Updated dependency bootstrap workflow to use the default branch and make the quality checks blocking before it attempts a normal push.
- Updated Android-only instructions to avoid separate review branches.
- Preserved the application source and existing architecture. No new customer-facing Smart Link feature is claimed as implemented in this release.

## Verification limits

This release ZIP has been checked for archive integrity and targeted text/workflow consistency only. GitHub Actions, dependency installation, real TypeScript/lint/test runs, PostgreSQL/RLS integration tests, and production deployment have not been run in this environment.


## 0.2.3-prep (2026-10-28)

- Added `PROGRESS-AND-HANDOFF-BN.txt` with project status, blockers, remaining roadmap, main-only Android instructions, and a new-chat prompt.
- Handoff/documentation repack only; no new customer-facing Smart Link features and no claim of full CI/build verification.
