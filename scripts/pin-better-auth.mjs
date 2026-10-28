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

// Retry only transient transport / HTTP failures. Policy failures (deprecated version,
// advisory, floor) are never retried or bypassed.
async function fetchJsonWithRetry(url, options = {}, label, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(options.timeoutMs ?? 30_000) });
      if (response.ok) return await response.json();
      const transient = response.status === 408 || response.status === 429 || response.status >= 500;
      if (!transient || attempt === attempts) throw new Error(`${label} responded HTTP ${response.status}${transient ? ' after retries' : ''}`);
      lastError = new Error(`${label} responded HTTP ${response.status}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt === attempts) break;
    }
    process.stderr.write(`${label} request failed (attempt ${attempt}/${attempts}); retrying shortly.\n`);
    await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
  }
  throw new Error(`${label} request failed after ${attempts} attempts: ${lastError?.message ?? 'unknown error'}`);
}

try {
  const registry = await fetchJsonWithRetry(
    'https://registry.npmjs.org/better-auth',
    { headers: { accept: 'application/json' }, timeoutMs: 30_000 },
    'npm registry',
  );
  const version = chooseStable(registry);

  const osvDoc = await fetchJsonWithRetry(
    'https://api.osv.dev/v1/query',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ package: { name: 'better-auth', ecosystem: 'npm' }, version }),
      timeoutMs: 20_000,
    },
    'OSV advisory service',
  );
  const { blocking } = evaluateOsv(osvDoc);
  if (blocking.length > 0) throw new Error(`better-auth@${version} has blocking advisories: ${blocking.map((b) => b.id).join(', ')}`);

  writeFileSync(file, setCatalogVersion(readFileSync(file, 'utf8'), 'better-auth', version));
  process.stdout.write(`pinned better-auth@${version} (stable, above floor, no critical/high advisory per OSV)\n`);
} catch (e) {
  process.stderr.write(`PIN FAILED (fail closed): ${e instanceof Error ? e.message : 'unknown error'}\n`);
  process.exit(1);
}
