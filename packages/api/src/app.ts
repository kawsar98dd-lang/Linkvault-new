import { OpenAPIHono } from '@hono/zod-openapi';
import { accessLog, notFoundHandler, onError, requestId } from './middleware/core.ts';
import { findUndeclaredRoutes, validateRegistry } from './registry.ts';
import { registerIdentityRoutes } from './routes/identity.ts';
import { registerWorkspaceRoutes } from './routes/workspaces.ts';
import type { ApiDeps, ApiEnv, RouteMeta } from './types.ts';
import type { RouteKit } from './declare.ts';

export const API_BASE_PATH = '/api/v1';

export interface ApiApp {
  app: OpenAPIHono<ApiEnv>;
  registry: readonly RouteMeta[];
}

/** Builds the versioned API. Throws at startup if any route lacks a valid authorization declaration. */
export function createApiApp(deps: ApiDeps): ApiApp {
  const app = new OpenAPIHono<ApiEnv>().basePath(API_BASE_PATH);
  app.use('*', requestId());
  app.use('*', accessLog(deps));
  app.onError(onError(deps));
  app.notFound(notFoundHandler());

  const registry: RouteMeta[] = [];
  const kit: RouteKit = { app, deps, registry };
  registerIdentityRoutes(kit);
  registerWorkspaceRoutes(kit);

  app.doc('/openapi.json', {
    openapi: '3.0.3',
    info: { title: 'BnlinkVault API', version: '1.0.0', description: 'Phase 2 platform foundation API.' },
    servers: [{ url: API_BASE_PATH }],
  });
  registry.push({ id: 'openapi.get', method: 'get', path: '/openapi.json', auth: 'public', reason: 'Static API description; contains no tenant or user data' });

  const problems = validateRegistry(registry);
  const undeclared = findUndeclaredRoutes(app.routes, registry, API_BASE_PATH);
  if (problems.length > 0 || undeclared.length > 0) {
    throw new Error(`Invalid route declarations: ${[...problems, ...undeclared.map((u) => `${u}: not declared`)].join('; ')}`);
  }
  return { app, registry };
}
