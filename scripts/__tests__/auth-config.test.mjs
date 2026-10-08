import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const src = strip(readFileSync(join(REPO, 'packages/auth/src/better-auth/create-auth.ts'), 'utf8'));

test('Better Auth session.cookieCache is explicitly disabled (2FA/session-caching advisory guard)', () => {
  assert.match(src, /cookieCache:\s*\{\s*enabled:\s*false\s*\}/);
  assert.doesNotMatch(src, /cookieCache:\s*\{[^}]*enabled:\s*true/);
  assert.doesNotMatch(src, /cookieCache:\s*true/);
  assert.doesNotMatch(src, /secondaryStorage/); // no cache layer for sessions
});

test('rate limiting is delegated to our guard and account linking stays disabled', () => {
  assert.match(src, /rateLimit:\s*\{\s*enabled:\s*false\s*\}/);
  assert.match(src, /accountLinking:\s*\{\s*enabled:\s*false\s*\}/);
  assert.match(src, /requireEmailVerification:\s*true/);
  assert.match(src, /twoFactor\(/);
});

test('cookieCache is not configured anywhere else in first-party source', async () => {
  const { readdirSync, statSync } = await import('node:fs');
  const hits = [];
  (function walk(d) {
    for (const n of readdirSync(d)) {
      if (n === 'node_modules' || n === '.next' || n === 'coverage') continue;
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(n) && /cookieCache/.test(strip(readFileSync(p, 'utf8'))) && !p.endsWith('create-auth.ts') && !p.includes('/test/')) hits.push(p);
    }
  })(join(REPO, 'packages'));
  assert.deepEqual(hits, []);
});
