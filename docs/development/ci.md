# CI

Workflow: `.github/workflows/ci.yml` (+ `codeql.yml`, `dependency-review.yml`, `generate-lockfile.yml`).

| job (required check) | proves |
|---|---|
| `static` | frozen install, boundaries, route declarations, script self-tests (incl. static workflow review), secret scan, typecheck, lint, **Prettier `format:check`**, unit tests, 100% branch coverage for authorization/CSRF |
| `database` | on real PostgreSQL 16: fresh migrations, roles (no BYPASSRLS), RLS read/update/delete isolation, audit append-only, invitations, schema parity, service + API security tests, Better Auth flows incl. TOTP |
| `web` | CLI provision+migrate on an empty DB, replay no-op, live `app_rw` role check, build with canary secrets, browser-bundle scan, `/healthz`, `/readyz` ready, `/readyz` 503 when the DB is unreachable, headers |
| `security` | gitleaks (full history), `pnpm audit`, Better Auth gate (floor 1.4.9 + OSV, fail closed), no floating versions |
| `semgrep` | Semgrep on a GitHub-hosted runner with maintained rulesets (`p/default`, `p/typescript`, `p/javascript`, `p/nodejs`, `p/owasp-top-ten`, `p/secrets`); any ERROR/WARNING finding or scanner/rule-fetch failure fails the job; the log lists rule id + location only (no code snippets). `scripts/__tests__` fixtures (runtime-built fake secrets) are excluded |
| `sentry` | sends a test event (fails if `SENTRY_DSN` secret missing); runs on non-PR events |

**"Failure blocks merge" is a repository setting, not code.** In GitHub: Settings → Branches → protect `main`
→ require the checks above (`static`, `database`, `web`, `security`, `semgrep`, `codeql / analyze`, `dependency-review`),
require PR review and CODEOWNERS review (edit `.github/CODEOWNERS` handles first), disallow bypass.

Neon branching: the workflow foundation is the `database` job's disposable database; a per-PR Neon branch
(`neondatabase/create-branch-action`) can replace the service container once a Neon project/API key exist.

## First-run order (everything is blocked until step 1 succeeds)
1. Run **generate-lockfile** (Actions tab). It resolves and verifies the Better Auth pin, generates `pnpm-lock.yaml`,
   runs Prettier, and attaches real `tsc`/ESLint logs; merge branch `chore/bootstrap`.
2. Open a PR: `ci` (static, database, web, security, semgrep), `codeql`, `dependency-review` run.
3. Fix whatever the first real runs reveal (TypeScript, ESLint, SQL, Better Auth API drift).

Notes: CodeQL results only block merges if the branch ruleset requires code-scanning results. Prettier is now a
required `static` step; formatting is applied once by the bootstrap workflow, never by hand-editing generated files
(`pnpm-lock.yaml`, SQL migrations and the generated permission matrix are in `.prettierignore`).
ESLint uses `strictTypeChecked`; first runs may surface findings that could not be seen at authoring time.
