import { CsrfTokenSchema, MeSchema, SessionParams, SessionViewSchema } from '@bnlinkvault/contracts';
import { notFound } from '@bnlinkvault/core';
import { z } from 'zod';
import { createRoute, declareRoute, type RouteKit } from '../declare.ts';
import { csrfTokenFor } from '../middleware/security.ts';
import { errorResponses, jsonOk, noContent } from './common.ts';

export function registerIdentityRoutes(kit: RouteKit): void {
  declareRoute(
    kit,
    { id: 'me.get', method: 'get', path: '/me', auth: 'session', action: 'user:read_self', resource: 'user', tenant: false },
    createRoute({ method: 'get', path: '/me', tags: ['identity'], responses: { 200: jsonOk(MeSchema, 'Current user'), ...errorResponses } }),
    (c) => {
      const s = c.get('session');
      return c.json({ id: s.userId, email: s.email, name: s.name, email_verified: s.emailVerified, two_factor_enabled: s.twoFactorEnabled }, 200);
    },
  );

  declareRoute(
    kit,
    { id: 'csrf.issue', method: 'get', path: '/csrf', auth: 'session', action: 'csrf:issue', resource: 'csrf', tenant: false },
    createRoute({ method: 'get', path: '/csrf', tags: ['identity'], responses: { 200: jsonOk(CsrfTokenSchema, 'Session-bound CSRF token (keep in memory only)'), ...errorResponses } }),
    (c) => c.json({ csrf_token: csrfTokenFor(kit.deps, c.get('session').sessionId) }, 200),
  );

  declareRoute(
    kit,
    { id: 'sessions.list', method: 'get', path: '/sessions', auth: 'session', action: 'session:list', resource: 'session', tenant: false },
    createRoute({ method: 'get', path: '/sessions', tags: ['identity'], responses: { 200: jsonOk(z.object({ data: z.array(SessionViewSchema) }), 'Active sessions'), ...errorResponses } }),
    async (c) => {
      const sessions = await kit.deps.auth.listSessions(c.req.raw.headers);
      return c.json(
        { data: sessions.map((s) => ({ id: s.id, created_at: s.createdAt.toISOString(), expires_at: s.expiresAt.toISOString(), user_agent: s.userAgent, current: s.current })) },
        200,
      );
    },
  );

  declareRoute(
    kit,
    { id: 'sessions.revoke', method: 'delete', path: '/sessions/{session_id}', auth: 'session', action: 'session:revoke', resource: 'session', tenant: false },
    createRoute({ method: 'delete', path: '/sessions/{session_id}', tags: ['identity'], request: { params: SessionParams }, responses: { 204: noContent, ...errorResponses } }),
    async (c) => {
      const { session_id } = c.req.valid('param');
      if (!(await kit.deps.auth.revokeSession(c.req.raw.headers, session_id))) throw notFound();
      return c.body(null, 204);
    },
  );
}
