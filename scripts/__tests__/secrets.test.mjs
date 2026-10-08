import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { scanBundle } from '../scan-browser-bundle.mjs';
import { findSecrets, shannonEntropy } from '../lib/secret-patterns.mjs';

// Fake secrets are assembled at runtime so this file itself never contains a real-looking secret.
const j = (...p) => p.join('');
const rnd = (n) => Array.from({ length: n }, (_, i) => 'aZ3kQ9xLm2PvB7tWc5RyN8dFh1JsU4oE'[(i * 7 + 3) % 32]).join('');

test('detects private keys, cloud/provider tokens and credentialed DB URLs', () => {
  assert.equal(findSecrets(j('-----BEGIN RSA ', 'PRIVATE KEY-----'))[0].rule, 'private-key');
  assert.equal(findSecrets(j('k = "AKIA', 'ABCDEFGHIJKLMNOP"'))[0].rule, 'aws-access-key');
  assert.equal(findSecrets(j('gh', 'p_', 'a'.repeat(36)))[0].rule, 'github-token');
  assert.equal(findSecrets(j('url=postgres', '://svc_user:S3cr3tPw9z', '@db.internal:5432/app'))[0].rule, 'database-url-with-credentials');
  assert.equal(findSecrets(j('t=ey', 'JhbGciOiJIUzI1NiJ9.ey', 'JzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop'))[0].rule, 'jwt');
});

test('detects the LEGACY browser-shipped SECRET_KEY / admin hash pattern', () => {
  assert.equal(findSecrets(j("SECRET_KEY: '", rnd(20), "'"))[0].rule, 'legacy-browser-secret-key');
  assert.equal(findSecrets(j("ADMIN_HASH: 'lv_", 'abc123', "'"))[0].rule, 'legacy-browser-secret-key');
  assert.equal(findSecrets('window.LV_SITE = {}')[0].rule, 'legacy-LV_SITE-global');
  assert.deepEqual(findSecrets("SECRET_KEY: 'x'", { skipLegacyRules: false }), []); // too short to be a secret
});

test('flags high-entropy secret assignments but not placeholders or low entropy', () => {
  assert.equal(findSecrets(j('BETTER_AUTH_SECRET="', rnd(32), '"'))[0].rule, 'secret-assignment-high-entropy');
  assert.deepEqual(findSecrets('BETTER_AUTH_SECRET="CHANGE_ME_CHANGE_ME_CHANGE_ME"'), []);
  assert.deepEqual(findSecrets('API_TOKEN="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"'), []);
  assert.deepEqual(findSecrets('DB=postgres://app_rw:CHANGE_ME@localhost:5432/x'), []);
  assert.deepEqual(findSecrets('DB=postgres://user:${PASSWORD}@host/x'), []);
});

test('respects the explicit allow marker and never prints the full secret', () => {
  assert.deepEqual(findSecrets(j('k = "AKIA', 'ABCDEFGHIJKLMNOP" // secretscan:allow documented fixture')), []);
  const f = findSecrets(j('k = "AKIA', 'ABCDEFGHIJKLMNOP"'))[0];
  assert.ok(!f.preview.includes('ABCDEFGHIJKLMNOP'));
});

test('entropy helper sanity', () => {
  assert.equal(shannonEntropy(''), 0);
  assert.ok(shannonEntropy(rnd(40)) > 3.5);
  assert.ok(shannonEntropy('aaaaaaaa') < 0.1);
});

function makeBundle(files) {
  const dir = mkdtempSync(join(tmpdir(), 'bundle-'));
  mkdirSync(join(dir, 'chunks'));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

test('browser-bundle scan: clean bundle passes', () => {
  const dir = makeBundle({ 'chunks/app.js': 'console.log("hello world");' });
  const r = scanBundle(dir, { BETTER_AUTH_SECRET: rnd(40) });
  assert.equal(r.files, 1);
  assert.deepEqual(r.findings, []);
});

test('browser-bundle scan: fails when a server secret VALUE appears in browser JS', () => {
  const secret = j('canary_', rnd(40));
  const dir = makeBundle({ 'chunks/leak.js': `var a="${secret}";` });
  const r = scanBundle(dir, { CSRF_SECRET: secret });
  assert.ok(r.findings.some((f) => f.rule === 'server-secret-value-in-bundle' && f.detail === 'CSRF_SECRET'));
});

test('browser-bundle scan: fails when server-secret NAMES or legacy globals appear', () => {
  const dir = makeBundle({ 'chunks/a.js': 'process.env.BETTER_AUTH_SECRET', 'chunks/b.js': 'window.LV_SITE={}' });
  const r = scanBundle(dir, {});
  assert.ok(r.findings.filter((f) => f.rule === 'server-secret-name-in-bundle').length >= 2);
});

test('browser-bundle scan: ignores short/absent env values (no false canary matches)', () => {
  const dir = makeBundle({ 'chunks/a.js': 'var x="abc";' });
  assert.deepEqual(scanBundle(dir, { CSRF_SECRET: 'abc' }).findings, []);
});
