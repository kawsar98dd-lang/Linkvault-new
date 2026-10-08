#!/usr/bin/env node
// Resolves the CURRENT stable Better Auth version from the npm registry, verifies it, and pins it EXACTLY
// in pnpm-workspace.yaml. Never writes "latest" or a range. Requires network (runs in the generate-lockfile
// workflow). Fails closed on any problem: no registry, version missing/deprecated/prerelease, below floor,
// critical/high/unknown advisory, or OSV unreachable.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateOsv } from './lib/advisory.mjs';
import { chooseStable, setCatalogVersion } from './lib/pin.mjs';

const file = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'pnpm-workspace.yaml');
try {
  const reg = await fetch('https://registry.npmjs.org/better-auth', { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
  if (!reg.ok) throw new Error(`npm registry responded ${reg.status}`);
  const version = chooseStable(await reg.json());

  const osv = await fetch('https://api.osv.dev/v1/query', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ package: { name: 'better-auth', ecosystem: 'npm' }, version }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!osv.ok) throw new Error(`OSV responded ${osv.status}`);
  const { blocking } = evaluateOsv(await osv.json());
  if (blocking.length > 0) throw new Error(`better-auth@${version} has blocking advisories: ${blocking.map((b) => b.id).join(', ')}`);

  writeFileSync(file, setCatalogVersion(readFileSync(file, 'utf8'), 'better-auth', version));
  process.stdout.write(`pinned better-auth@${version} (stable, above floor, no critical/high advisory per OSV)\n`);
} catch (e) {
  process.stderr.write(`PIN FAILED (fail closed): ${e instanceof Error ? e.message : 'unknown error'}\n`);
  process.exit(1);
}
