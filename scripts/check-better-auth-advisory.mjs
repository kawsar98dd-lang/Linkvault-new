#!/usr/bin/env node
// Better Auth security gate (Phase 2 spec §12/§24). FAILS CLOSED. Requires network access (runs in CI).
//   1. policy: the pinned version must be an exact stable version >= BETTER_AUTH_MIN_VERSION
//   2. advisories: OSV is queried for that EXACT version; critical/high/unknown-severity => failure
// Exit codes: 0 = acceptable, 1 = BLOCKING (policy or advisory), 2 = could not verify (network/parse).
// There is no override flag and no "skip" path.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkVersionPolicy, evaluateOsv, pinnedVersion } from './lib/advisory.mjs';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const version = pinnedVersion(readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8'), 'better-auth');

const policyError = checkVersionPolicy(version);
if (policyError) {
  process.stderr.write(`BLOCKING: ${policyError}\n`);
  process.exit(1);
}
try {
  const res = await fetch('https://api.osv.dev/v1/query', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ package: { name: 'better-auth', ecosystem: 'npm' }, version }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`OSV responded ${res.status}`);
  const body = await res.json();
  if (body === null || typeof body !== 'object') throw new Error('OSV returned an unexpected payload');
  const { blocking, warnings } = evaluateOsv(body);
  for (const w of warnings) process.stdout.write(`warning: ${w.id} (${w.severity}) ${w.summary}\n`);
  if (blocking.length > 0) {
    process.stderr.write(`BLOCKING: better-auth@${version} has critical/high/unknown-severity advisories:\n`);
    for (const b of blocking) process.stderr.write(`  ${b.id} (${b.severity}) ${b.summary} fixed in: ${b.fixed.join(', ') || 'n/a'}\n`);
    process.exit(1);
  }
  process.stdout.write(`better-auth@${version}: version policy OK; OSV reports no critical/high advisories for this exact version\n`);
} catch (e) {
  process.stderr.write(`NOT VERIFIED (treated as failure): ${e instanceof Error ? e.message : 'unknown error'}\n`);
  process.exit(2);
}
