#!/usr/bin/env node
// Static guard: every API route must be registered with a complete routeGuard(kit, meta) declaration.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRouteDeclarations } from './lib/route-declarations.mjs';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const { problems, usedActions, openapiCalls } = checkRouteDeclarations(root);
if (problems.length > 0) {
  process.stderr.write('Route declaration problems:\n');
  for (const p of problems) process.stderr.write(`  - ${p}\n`);
  process.exit(1);
}
process.stdout.write(`route declarations: OK (${openapiCalls} routes, ${usedActions.size} actions covered)\n`);
