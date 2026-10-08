import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateOsv, pinnedVersion } from '../lib/advisory.mjs';

test('critical, high and unknown severities block; moderate/low only warn', () => {
  const r = evaluateOsv({
    vulns: [
      { id: 'GHSA-1', summary: 's1', database_specific: { severity: 'CRITICAL' }, affected: [{ ranges: [{ events: [{ introduced: '0' }, { fixed: '1.2.9' }] }] }] },
      { id: 'GHSA-2', database_specific: { severity: 'high' } },
      { id: 'GHSA-3' },
      { id: 'GHSA-4', database_specific: { severity: 'MODERATE' } },
      { id: 'GHSA-5', database_specific: { severity: 'LOW' } },
    ],
  });
  assert.deepEqual(r.blocking.map((b) => b.id), ['GHSA-1', 'GHSA-2', 'GHSA-3']);
  assert.deepEqual(r.blocking[0].fixed, ['1.2.9']);
  assert.deepEqual(r.warnings.map((w) => w.id), ['GHSA-4', 'GHSA-5']);
});

test('no vulnerabilities => nothing blocks; malformed input is tolerated', () => {
  assert.deepEqual(evaluateOsv({}), { blocking: [], warnings: [] });
  assert.deepEqual(evaluateOsv(null), { blocking: [], warnings: [] });
});

test('reads the pinned version from the pnpm catalog', () => {
  const yaml = 'catalog:\n  zod: 3.24.2\n  better-auth: 1.2.7\n  "@hono/zod-openapi": 0.19.2\n';
  assert.equal(pinnedVersion(yaml, 'better-auth'), '1.2.7');
  assert.equal(pinnedVersion(yaml, '@hono/zod-openapi'), '0.19.2');
  assert.equal(pinnedVersion(yaml, 'missing'), null);
});
