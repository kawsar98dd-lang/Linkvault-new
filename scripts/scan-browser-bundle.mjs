#!/usr/bin/env node
// Fails if any server-only secret value (or secret-shaped string) appears in browser JavaScript.
// CI builds with canary values for every server variable, then runs this against .next/static.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { findSecrets } from './lib/secret-patterns.mjs';

export const SERVER_ONLY_ENV = [
  'DATABASE_URL', 'MIGRATOR_DATABASE_URL', 'ADMIN_DATABASE_URL', 'TEST_ADMIN_DATABASE_URL',
  'APP_RW_PASSWORD', 'APP_MIGRATOR_PASSWORD', 'BETTER_AUTH_SECRET', 'CSRF_SECRET',
  'GOOGLE_CLIENT_SECRET', 'TURNSTILE_SECRET_KEY', 'POSTMARK_SERVER_TOKEN', 'SENTRY_AUTH_TOKEN',
];
// Variable NAMES that must never be referenced by browser code either.
const FORBIDDEN_NAMES = /\b(BETTER_AUTH_SECRET|CSRF_SECRET|MIGRATOR_DATABASE_URL|ADMIN_DATABASE_URL|APP_RW_PASSWORD|APP_MIGRATOR_PASSWORD|SECRET_KEY|ADMIN_HASH|LV_SITE)\b/;

export function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (/\.(js|mjs|cjs|map|html|json|css)$/.test(name)) yield p;
  }
}

/** @param {Record<string, string | undefined>} env */
export function scanBundle(dir, env = process.env) {
  const findings = [];
  const secrets = SERVER_ONLY_ENV.map((n) => [n, env[n]]).filter(([, v]) => typeof v === 'string' && v.length >= 8);
  let files = 0;
  for (const file of walk(dir)) {
    files++;
    const text = readFileSync(file, 'utf8');
    for (const [name, value] of secrets) {
      if (text.includes(value)) findings.push({ file, rule: 'server-secret-value-in-bundle', detail: name });
    }
    const nm = FORBIDDEN_NAMES.exec(text);
    if (nm) findings.push({ file, rule: 'server-secret-name-in-bundle', detail: nm[1] });
    for (const f of findSecrets(text)) findings.push({ file, rule: f.rule, detail: `line ${f.line} ${f.preview}` });
  }
  return { files, findings, checkedEnvVars: secrets.map(([n]) => n) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2] ?? 'apps/web/.next/static';
  let result;
  try {
    result = scanBundle(dir);
  } catch (e) {
    process.stderr.write(`cannot scan ${dir}: ${e instanceof Error ? e.message : 'error'} (did the build run?)\n`);
    process.exit(2);
  }
  if (result.files === 0) {
    process.stderr.write(`no browser files found in ${dir}: refusing to report success\n`);
    process.exit(2);
  }
  if (result.findings.length > 0) {
    process.stderr.write('Server-only secrets detected in browser bundle:\n');
    for (const f of result.findings) process.stderr.write(`  ${f.file} [${f.rule}] ${f.detail}\n`);
    process.exit(1);
  }
  process.stdout.write(`browser bundle scan: ${result.files} files, ${result.checkedEnvVars.length} canary env values checked, no findings\n`);
}
