import { createRoute, type OpenAPIHono, type RouteConfig, type RouteHandler } from '@hono/zod-openapi';
import type { MiddlewareHandler } from 'hono';
import { authenticate, authorize, resolveTenant } from './middleware/authz.ts';
import { idempotency } from './middleware/idempotency.ts';
import { csrf, rateLimit } from './middleware/security.ts';
import type { ApiDeps, ApiEnv, RouteMeta } from './types.ts';

export interface RouteKit {
  app: OpenAPIHono<ApiEnv>;
  deps: ApiDeps;
  registry: RouteMeta[];
}

export { createRoute };

/**
 * THE only way to add an API route. It couples the OpenAPI route with a mandatory RouteMeta
 * (auth mode, resource, action, tenant requirement) and builds the middleware chain from it:
 *   rate-limit(ip) -> authenticate -> rate-limit(user) -> CSRF -> tenant -> authorize -> idempotency
 * then zod validation and the handler. Handlers never implement authorization themselves.
 */
export function declareRoute<R extends RouteConfig>(kit: RouteKit, meta: RouteMeta, route: R, handler: RouteHandler<R, ApiEnv>): void {
  if (meta.method !== route.method || meta.path !== route.path) {
    throw new Error(`RouteMeta ${meta.id} does not match its OpenAPI route (${meta.method} ${meta.path} vs ${route.method} ${route.path})`);
  }
  const chain: MiddlewareHandler<ApiEnv>[] = [rateLimit(kit.deps, 'ip')];
  if (meta.auth === 'session') {
    chain.push(authenticate(kit.deps), rateLimit(kit.deps, 'user'), csrf(kit.deps));
    if (meta.tenant) chain.push(resolveTenant(kit.deps));
    chain.push(authorize(meta));
    if (meta.idempotent === true) chain.push(idempotency(kit.deps, meta.tenant));
  }
  kit.registry.push(meta);
  kit.app.openapi({ ...route, middleware: chain } as R, handler);
}
