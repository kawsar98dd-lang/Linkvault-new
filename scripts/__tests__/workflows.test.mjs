import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// Static review of the workflow files (text-level; does NOT prove they run on GitHub).
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f) => readFileSync(join(REPO, '.github/workflows', f), 'utf8');
const ci = read('ci.yml');
const jobBlock = (name) => {
  const start = ci.indexOf(`\n  ${name}:`);
  assert.ok(start >= 0, `job ${name} missing`);
  const rest = ci.slice(start + 1);
  const next = rest.slice(1).search(/\n  [a-z-]+:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
};

test('every job that installs requires a committed lockfile and uses a frozen install', () => {
  for (const job of ['static', 'database', 'web', 'security', 'sentry']) {
    const b = jobBlock(job);
    assert.match(b, /pnpm-lock\.yaml/, `${job}: lockfile presence check`);
    assert.match(b, /pnpm install --frozen-lockfile/, `${job}: frozen install`);
    assert.doesNotMatch(b, /pnpm install(?! --frozen-lockfile)/, `${job}: non-frozen install`);
  }
});

test('lockfile check cannot be silently skipped (no continue-on-error / || true on gates)', () => {
  assert.doesNotMatch(ci, /continue-on-error:\s*true/);
  for (const line of ci.split('\n')) {
    if (/pnpm (audit|check:)|gitleaks|semgrep scan/.test(line)) assert.doesNotMatch(line, /\|\|\s*true/);
  }
});

test('database jobs use a real PostgreSQL service (no sqlite / pg-mem / mocks)', () => {
  assert.match(jobBlock('database'), /image:\s*postgres:16/);
  assert.match(jobBlock('web'), /image:\s*postgres:16/);
  assert.doesNotMatch(ci, /sqlite|pg-mem|pglite/i);
});

test('static job runs boundaries, routes, typecheck, lint, Prettier and unit tests', () => {
  const b = jobBlock('static');
  for (const cmd of ['check:boundaries', 'check:routes', 'check:secrets', 'pnpm typecheck', 'pnpm lint', 'pnpm format:check', 'pnpm test:unit']) assert.ok(b.includes(cmd), cmd);
});

test('security job: gitleaks (full history), dependency audit, Better Auth gate; Semgrep job is blocking', () => {
  const b = jobBlock('security');
  assert.match(b, /fetch-depth:\s*0/);
  assert.match(b, /gitleaks\/gitleaks-action/);
  assert.match(b, /pnpm audit --audit-level=high/);
  assert.match(b, /pnpm check:better-auth/);
  const s = jobBlock('semgrep');
  assert.match(s, /semgrep scan/);
  assert.match(s, /--error/);
  assert.match(s, /p\/default/);
  assert.match(s, /p\/owasp-top-ten/);
  assert.match(s, /p\/secrets/);
  assert.match(s, /fail(ing)? closed/i);
});

test('web job: canary secrets, scan AFTER the real build, /readyz tested reachable and unreachable', () => {
  const b = jobBlock('web');
  const build = b.indexOf('pnpm --filter @bnlinkvault/web build');
  const scan = b.indexOf('scripts/scan-browser-bundle.mjs');
  const start = b.indexOf('web start');
  assert.ok(build > 0 && scan > build && start > scan, 'order: build -> bundle scan -> start');
  for (const v of ['BETTER_AUTH_SECRET', 'CSRF_SECRET', 'POSTMARK_SERVER_TOKEN', 'GOOGLE_CLIENT_SECRET', 'APP_RW_PASSWORD', 'APP_MIGRATOR_PASSWORD']) assert.match(b, new RegExp(`${v}: canary-`));
  assert.match(b, /"ready"/);
  assert.match(b, /localhost:5999/); // unreachable database
  assert.match(b, /test "\$code" = "503"/);
  assert.match(b, /bnlinkvault_ci/); // fresh database via the production CLIs
  assert.match(b, /pnpm db:provision/);
  assert.match(b, /pnpm db:migrate/);
  assert.match(b, /false,false/); // live app_rw role check
});

test('workflows never print secrets (no xtrace, no echo of credentials, no env dump)', () => {
  for (const f of readdirSync(join(REPO, '.github/workflows'))) {
    const t = read(f);
    assert.doesNotMatch(t, /set -x|bash -x|\benv\s*\|\s*sort|\bprintenv\b|echo\s+"?\$\{?\{?\s*secrets\./, `${f}`);
    assert.doesNotMatch(t, /echo[^\n]*(PASSWORD|SECRET|TOKEN)[^\n]*\$/i, `${f}: echoes a credential variable`);
  }
});

test('permissions are least-privilege and workflow tokens are scoped', () => {
  assert.match(ci, /^permissions:\s*\n\s+contents:\s*read/m);
  assert.match(read('codeql.yml'), /security-events:\s*write/);
  assert.match(read('dependency-review.yml'), /contents:\s*read/);
  assert.match(read('generate-lockfile.yml'), /contents:\s*write/); // only the bootstrap workflow may push
});

test('bootstrap workflow resolves + gates the Better Auth pin and never fabricates a lockfile', () => {
  const t = read('generate-lockfile.yml');
  const order = ['pin-better-auth.mjs', 'check-better-auth-advisory.mjs', 'pnpm install --lockfile-only', 'pnpm install --frozen-lockfile', 'pnpm format'].map((s) => t.indexOf(s));
  assert.ok(order.every((i) => i > 0) && order.every((v, i) => i === 0 || v > order[i - 1]), 'step order');
  assert.doesNotMatch(t, /cat\s*>\s*pnpm-lock/);
});

test('codeql and dependency-review workflows exist with the expected actions', () => {
  assert.match(read('codeql.yml'), /github\/codeql-action\/analyze@v3/);
  assert.match(read('codeql.yml'), /security-extended/);
  assert.match(read('dependency-review.yml'), /fail-on-severity:\s*high/);
});

test('no lockfile exists in the repository (it must come from the networked runner, never be invented)', () => {
  assert.throws(() => readFileSync(join(REPO, 'pnpm-lock.yaml')), /ENOENT/);
});

test('the floating-version guard matches VALUES, not the "next" dependency key (no false positive)', () => {
  const line = /grep -RIn --include=package\.json -E '([^']+)'/.exec(ci)?.[1];
  assert.ok(line, 'guard present');
  const re = new RegExp(line.replace(/\[\[:space:\]\]/g, '\\s'));
  assert.doesNotMatch('    "next": "catalog:",', re);
  assert.match('    "zod": "latest",', re);
  assert.match('    "x": "*"', re);
  assert.match('npx foo@latest', re);
});
