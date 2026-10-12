#!/usr/bin/env node
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkBoundaries } from './lib/boundaries.mjs';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const problems = checkBoundaries(root);
if (problems.length > 0) {
  process.stderr.write('Architecture boundary violations:\n');
  for (const p of problems) process.stderr.write(`  - ${p}\n`);
  process.exit(1);
}
process.stdout.write('architecture boundaries: OK\n');
