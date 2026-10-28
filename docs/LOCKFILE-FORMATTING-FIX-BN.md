# Lockfile formatting blocker — correction plan (2026-10-28)

## Evidence
The GitHub Actions `generate-lockfile #6` screenshot shows:
- Better Auth registry resolution and the security gate: success.
- `pnpm install --lockfile-only`: success.
- Frozen install: success.
- `pnpm format:check`: failed with `Code style issues found in 128 files`.
- TypeScript, ESLint, tests, and commit were skipped because the formatting step failed.

## Workflow change in this ZIP
The proposed `generate-lockfile.yml` now runs Prettier using the repository's checked-in configuration (`pnpm exec prettier --write .`) and immediately verifies with `pnpm format:check`. Existing `.prettierignore` exclusions remain in effect, including SQL migrations and workflow files.
If formatting, typecheck, lint, and tests all pass, the workflow stages tracked formatting-only changes together with `pnpm-lock.yaml` and `pnpm-workspace.yaml`, then makes a normal commit/push to the default branch. No force push is used and strict peer/security checks remain enabled.

## Important import behavior
The `import-zip` workflow deliberately does not copy files from the ZIP directly into `.github/workflows/`. A changed workflow is placed under `pending-workflows/generate-lockfile.yml`. After importing this ZIP, review that file and manually copy its contents into `.github/workflows/generate-lockfile.yml` using GitHub's editor, then commit on `main`. Do not delete the existing workflow before the replacement is ready.

## Validation status
- ZIP integrity and workflow text replacement: checked locally.
- Prettier, TypeScript, ESLint, tests, and GitHub Actions: not run in this local packaging step.
- The workflow is designed to stop without committing the lockfile if formatting or any later validation fails.
