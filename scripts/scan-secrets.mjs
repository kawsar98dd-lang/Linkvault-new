#!/usr/bin/env node
// Repository secret scanner (dependency-free). Complements gitleaks (CI runs both).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findSecrets } from './lib/secret-patterns.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', '.turbo', 'coverage', 'dist']);
const SKIP_FILES = new Set(['pnpm-lock.yaml']);
const SKIP_EXT = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|zip|gz|pdf)$/i;
// Fixtures that intentionally contain fake secrets are generated at runtime, but test sources and
// docs may still quote *patterns*; they are scanned with legacy-name rules relaxed, never skipped.
const RELAXED = [`scripts${sep}__tests__${sep}`, `docs${sep}`];

export function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (st.size < 1_500_000 && !SKIP_FILES.has(name) && !SKIP_EXT.test(name)) yield p;
  }
}

export function scanTree(root = ROOT) {
  const results = [];
  for (const file of walk(root)) {
    const rel = relative(root, file);
    const text = readFileSync(file, 'utf8');
    const relaxed = RELAXED.some((r) => rel.startsWith(r));
    for (const f of findSecrets(text, { skipLegacyRules: relaxed })) results.push({ file: rel, ...f });
  }
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const results = scanTree();
  if (results.length > 0) {
    process.stderr.write('Potential secrets found:\n');
    for (const r of results) process.stderr.write(`  ${r.file}:${r.line}  [${r.rule}]  ${r.preview}\n`);
    process.stderr.write('Remove them, rotate if real, or add an inline "secretscan:allow" marker with justification.\n');
    process.exit(1);
  }
  process.stdout.write('secret scan: no findings\n');
}
