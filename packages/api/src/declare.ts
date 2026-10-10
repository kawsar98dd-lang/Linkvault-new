import type { OpenAPIHono } from '@hono/zod-openapi';
import type { MiddlewareHandler } from 'hono';
import { authenticate, authorize, resolveTenant } from './middleware/authz.ts';
import { idempotency } from './middleware/idempotency.ts';
import { csrf, rateLimit } from './middleware/security.ts';
import type { ApiDeps, ApiEnv, RouteMeta } from './types.ts';

export { createRoute } from '@hono/zod-openapi';

export interface RouteKit {
  app: OpenAPIHono<ApiEnv>;
  deps: ApiDeps;
  registry: RouteMeta[];
}

/**
 * Declares a route's authorization contract and returns the middleware chain for it:
 *   rate-limit(ip) -> authenticate -> rate-limit(user) -> CSRF -> tenant -> authorize -> idempotency
 * (validation and the handler follow). Every route is registered as
 *
 *   kit.app.openapi(createRoute({ ..., middleware: routeGuard(kit, { id, method, path, auth, action, resource, tenant }) }), handler)
 *
 * This function is intentionally NOT generic over the OpenAPI route type: the route object and the
 * handler are both typed at the call site, so `openapi()` infers the handler context from the concrete
 * route. (A generic wrapper `declare<R>(route: R, handler: RouteHandler<R>)` cannot prove that its handler
 * type equals the one `openapi()` derives from a deferred conditional on `R`, which is what failed typecheck.)
 *
 * Safety net: the meta (method + path) is cross-checked against the real router at startup
 * (see `createApiApp`: undeclared AND unregistered routes both throw), and statically by
 * `scripts/check-route-declarations.mjs`. Handlers never implement authorization themselves.
 */
export function routeGuard(kit: RouteKit, meta: RouteMeta): MiddlewareHandler<ApiEnv>[] {
  const chain: MiddlewareHandler<ApiEnv>[] = [rateLimit(kit.deps, 'ip')];
  if (meta.auth === 'session') {
    chain.push(authenticate(kit.deps), rateLimit(kit.deps, 'user'), csrf(kit.deps));
    if (meta.tenant) chain.push(resolveTenant(kit.deps));
    chain.push(authorize(meta));
    if (meta.idempotent === true) chain.push(idempotency(kit.deps, meta.tenant));
  }
  kit.registry.push(meta);
  return chain;
}
