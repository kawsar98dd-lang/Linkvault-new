import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { checkBoundaries, extractImports, findCycles } from '../lib/boundaries.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function mini(spec) {
  const root = mkdtempSync(join(tmpdir(), 'ws-'));
  for (const [path, content] of Object.entries(spec)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return root;
}
const pkg = (name, deps = {}, dev = {}) => ({ name: `@bnlinkvault/${name}`, dependencies: deps, devDependencies: dev });
const ws = '*';

test('the real repository satisfies every boundary rule', () => {
  assert.deepEqual(checkBoundaries(REPO), []);
});

test('extractImports handles static, type, export-from, dynamic and ignores comments', () => {
  const src = `import a from 'x';\nimport type { B } from "y";\nexport * from './z';\nexport { q } from 'w';\nconst m = await import('dyn');\n// import nope from 'commented';\n/* import no from 'block' */\nconst r = require('cjs');`;
  assert.deepEqual(extractImports(src).sort(), ['./z', 'cjs', 'dyn', 'w', 'x', 'y']);
});

test('detects forbidden production dependency edges', () => {
  const root = mini({
    'packages/contracts/package.json': pkg('contracts', { '@bnlinkvault/db': ws }),
    'packages/db/package.json': pkg('db'),
  });
  const problems = checkBoundaries(root);
  assert.ok(problems.some((p) => p.includes('forbidden production dependency on @bnlinkvault/db')));
});

test('detects dependency cycles (including via devDependencies)', () => {
  const g = new Map([['a', ['b']], ['b', ['c']], ['c', ['a']]]);
  assert.equal(findCycles(g).length, 1);
  assert.equal(findCycles(new Map([['a', ['b']], ['b', []]])).length, 0);
});

test('Better Auth may only be imported inside packages/auth/src/better-auth', () => {
  const root = mini({
    'packages/core/package.json': pkg('core', {}),
    'packages/core/src/leak.ts': "import { betterAuth } from 'better-auth';\n",
    'packages/auth/package.json': pkg('auth', { '@bnlinkvault/contracts': ws, '@bnlinkvault/db': ws }),
    'packages/auth/src/better-auth/ok.ts': "import { betterAuth } from 'better-auth';\n",
  });
  const problems = checkBoundaries(root).filter((p) => p.includes('better-auth'));
  assert.ok(problems.some((p) => p.startsWith('packages/core/src/leak.ts')));
  assert.ok(!problems.some((p) => p.startsWith('packages/auth/src/better-auth/ok.ts') && p.includes('not allowed')));
});

test('domain packages cannot import web frameworks; UI cannot import db/core; no localStorage', () => {
  const root = mini({
    'packages/core/package.json': pkg('core', {}),
    'packages/core/src/a.ts': "import { NextResponse } from 'next/server';\n",
    'apps/web/package.json': pkg('web', { '@bnlinkvault/db': ws }),
    'apps/web/src/app/page.tsx': "import { createPool } from '@bnlinkvault/db';\nlocalStorage.setItem('t','1');\n",
  });
  const problems = checkBoundaries(root);
  assert.ok(problems.some((p) => p.includes('packages/core/src/a.ts') && p.includes('"next/server"')));
  assert.ok(problems.some((p) => p.includes('apps/web/src/app/page.tsx') && p.includes('UI code must not import infrastructure')));
  assert.ok(problems.some((p) => p.includes('localStorage')));
});

test('undeclared internal imports, deep src imports and relative escapes are rejected', () => {
  const root = mini({
    'packages/api/package.json': pkg('api', { '@bnlinkvault/contracts': ws }),
    'packages/api/src/a.ts': "import x from '@bnlinkvault/db';\nimport y from '@bnlinkvault/contracts/src/x';\nimport z from '../../core/src/y';\n",
    'packages/db/package.json': pkg('db'),
    'packages/core/package.json': pkg('core'),
    'packages/contracts/package.json': pkg('contracts'),
  });
  const problems = checkBoundaries(root);
  assert.ok(problems.some((p) => p.includes('without declaring it')));
  assert.ok(problems.some((p) => p.includes('deep import')));
  assert.ok(problems.some((p) => p.includes('relative import escapes')));
});

test('nothing may depend on the web app and unknown packages must be added to the matrix', () => {
  const root = mini({
    'apps/web/package.json': pkg('web'),
    'packages/db/package.json': pkg('db', {}, { '@bnlinkvault/web': ws }),
    'packages/mystery/package.json': pkg('mystery'),
  });
  const problems = checkBoundaries(root);
  assert.ok(problems.some((p) => p.includes('nothing may depend on the web app')));
  assert.ok(problems.some((p) => p.includes('not listed in the boundary matrix')));
});
