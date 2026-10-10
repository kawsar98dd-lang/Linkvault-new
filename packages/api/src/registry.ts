import { ACTIONS, ACTION_RESOURCE, RESOURCE_TYPES } from '@bnlinkvault/contracts/domain';
import type { RouteMeta } from './types.ts';

/** Validates declarations. Used at startup (throws) and by tests/CI. Returns a list of problems. */
export function validateRegistry(registry: readonly RouteMeta[]): string[] {
  const problems: string[] = [];
  const seenIds = new Set<string>();
  const seenRoutes = new Set<string>();
  for (const r of registry) {
    const label = `${r.method.toUpperCase()} ${r.path} (${r.id})`;
    if (seenIds.has(r.id)) problems.push(`${label}: duplicate route id`);
    seenIds.add(r.id);
    const key = `${r.method} ${r.path}`;
    if (seenRoutes.has(key)) problems.push(`${label}: duplicate method+path`);
    seenRoutes.add(key);

    if (r.auth === 'public') {
      if (r.reason.trim().length < 10) problems.push(`${label}: public route needs a justification`);
      if (r.method !== 'get') problems.push(`${label}: public routes must be read-only`);
      continue;
    }
    if (r.auth !== 'session') {
      problems.push(`${label}: unknown auth mode`);
      continue;
    }
    if (!ACTIONS.includes(r.action)) problems.push(`${label}: unknown action`);
    if (!RESOURCE_TYPES.includes(r.resource)) problems.push(`${label}: unknown resource`);
    if (ACTION_RESOURCE[r.action] !== r.resource) problems.push(`${label}: action/resource mismatch`);
    const hasWsParam = r.path.includes('{ws}');
    if (r.tenant !== hasWsParam) problems.push(`${label}: tenant flag must match presence of {ws} in the path`);
    if (r.method !== 'get' && r.method !== 'delete' && r.idempotent === undefined) {
      problems.push(`${label}: mutating route must state idempotent true/false explicitly`);
    }
  }
  return problems;
}

/** Hono path (":ws") -> OpenAPI path ("{ws}") and strips the base path. */
export function normalizeRoutePath(honoPath: string, base = '/api/v1'): string {
  const p = honoPath.startsWith(base) ? honoPath.slice(base.length) : honoPath;
  return p.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}') || '/';
}

/** Routes present in the Hono router but missing from the registry (=> undeclared authorization). */
export function findUndeclaredRoutes(
  honoRoutes: readonly { method: string; path: string }[],
  registry: readonly RouteMeta[],
  base = '/api/v1',
): string[] {
  const declared = new Set(registry.map((r) => `${r.method.toUpperCase()} ${r.path}`));
  const missing: string[] = [];
  for (const r of honoRoutes) {
    if (r.method === 'ALL' || r.method === 'OPTIONS') continue; // middleware entries
    const key = `${r.method.toUpperCase()} ${normalizeRoutePath(r.path, base)}`;
    if (!declared.has(key)) missing.push(key);
  }
  return missing;
}

/** Declarations (RouteMeta) with no matching router entry: a mismatched path/method or a forgotten registration. */
export function findUnregisteredDeclarations(
  honoRoutes: readonly { method: string; path: string }[],
  registry: readonly RouteMeta[],
  base = '/api/v1',
): string[] {
  const present = new Set(
    honoRoutes
      .filter((r) => r.method !== 'ALL' && r.method !== 'OPTIONS')
      .map((r) => `${r.method.toUpperCase()} ${normalizeRoutePath(r.path, base)}`),
  );
  return registry.map((r) => `${r.method.toUpperCase()} ${r.path}`).filter((key) => !present.has(key));
}
