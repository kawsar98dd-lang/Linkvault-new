import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { BETTER_AUTH_MIN_VERSION, checkVersionPolicy, pinnedVersion } from '../lib/advisory.mjs';
import { chooseStable, setCatalogVersion } from '../lib/pin.mjs';
import { compareStable, parseStable } from '../lib/semver.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('semver helpers are strict', () => {
  assert.deepEqual(parseStable('1.4.9'), [1, 4, 9]);
  for (const bad of ['1.4', '1.4.9-beta.1', '^1.4.9', 'latest', '', null, undefined, '01x.2.3']) assert.equal(parseStable(bad), null);
  assert.equal(compareStable('1.4.9', '1.4.9'), 0);
  assert.equal(compareStable('1.4.10', '1.4.9'), 1);
  assert.equal(compareStable('1.2.7', '1.4.9'), -1);
  assert.equal(compareStable('2.0.0', '1.99.99'), 1);
  assert.equal(compareStable('1.4.9-rc.1', '1.4.9'), null);
});

test('version policy: vulnerable, unresolved, floating and missing pins are all rejected', () => {
  assert.equal(BETTER_AUTH_MIN_VERSION, '1.4.9');
  assert.match(checkVersionPolicy('1.2.7'), /below the security floor/);
  assert.match(checkVersionPolicy('1.4.8'), /below the security floor/);
  assert.match(checkVersionPolicy('0.0.0-UNRESOLVED'), /UNRESOLVED/);
  assert.match(checkVersionPolicy('latest'), /exact stable/);
  assert.match(checkVersionPolicy('^1.5.0'), /exact stable/);
  assert.match(checkVersionPolicy('1.5.0-beta.2'), /exact stable/);
  assert.match(checkVersionPolicy(null), /not pinned/);
  assert.equal(checkVersionPolicy('1.4.9'), null);
  assert.equal(checkVersionPolicy('1.9.3'), null);
});

test('the REAL repository does not currently contain a vulnerable or guessed Better Auth pin', () => {
  const v = pinnedVersion(readFileSync(join(REPO, 'pnpm-workspace.yaml'), 'utf8'), 'better-auth');
  assert.notEqual(v, '1.2.7');
  // Either still unresolved (installs fail closed and the gate fails) or an exact stable version above the floor.
  const err = checkVersionPolicy(v);
  assert.ok(err === null || /UNRESOLVED/.test(err), `unexpected state: ${err}`);
});

const doc = (latest, extra = {}) => ({ 'dist-tags': { latest }, versions: { [latest]: {}, ...extra } });

test('chooseStable accepts only an existing, non-deprecated, stable, above-floor latest', () => {
  assert.equal(chooseStable(doc('1.6.2')), '1.6.2');
  assert.throws(() => chooseStable(doc('1.6.2-beta.1')), /plain stable/);
  assert.throws(() => chooseStable({ 'dist-tags': { latest: '1.6.2' }, versions: {} }), /not present/);
  assert.throws(() => chooseStable({ 'dist-tags': { latest: '1.6.2' }, versions: { '1.6.2': { deprecated: 'broken' } } }), /deprecated/);
  assert.throws(() => chooseStable(doc('1.4.0')), /below the security floor/);
  assert.throws(() => chooseStable({}), /plain stable/);
  assert.throws(() => chooseStable(null), /plain stable/);
});

test('setCatalogVersion rewrites exactly one entry and refuses non-exact versions', () => {
  const yaml = 'catalog:\n  zod: 3.24.2\n  # note\n  better-auth: 0.0.0-UNRESOLVED # keep\n  hono: 4.7.5\n';
  const out = setCatalogVersion(yaml, 'better-auth', '1.6.2');
  assert.match(out, /better-auth: 1\.6\.2 # keep/);
  assert.match(out, /zod: 3\.24\.2/);
  assert.throws(() => setCatalogVersion(yaml, 'better-auth', '^1.6.2'), /non-exact/);
  assert.throws(() => setCatalogVersion(yaml, 'latest', '1.6.2'), /exactly one/);
  assert.throws(() => setCatalogVersion(`${yaml}  better-auth: 1.0.0\n`, 'better-auth', '1.6.2'), /exactly one/);
});

test('the gate script has no skip/override path and fails closed on every exit route', () => {
  const src = readFileSync(join(REPO, 'scripts/check-better-auth-advisory.mjs'), 'utf8');
  assert.ok(!/process\.env\.(SKIP|IGNORE|ALLOW)/i.test(src));
  assert.ok(/process\.exit\(2\)/.test(src) && /NOT VERIFIED \(treated as failure\)/.test(src));
  assert.ok(/checkVersionPolicy\(version\)/.test(src));
  assert.ok(/version,\s*\}\)|version \}\)/.test(src) || /ecosystem: 'npm' \}, version/.test(src));
});
