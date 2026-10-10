import {
  AcceptInvitationBody,
  AuditLogSchema,
  CreateInvitationBody,
  CreateWorkspaceBody,
  InvitationParams,
  InvitationSchema,
  MemberParams,
  MemberSchema,
  PageQuerySchema,
  TransferOwnershipBody,
  UpdateMemberRoleBody,
  UpdateWorkspaceBody,
  WorkspaceParams,
  WorkspaceSchema,
  pageOf,
} from '@bnlinkvault/contracts';
import { z } from 'zod';
import { createRoute, routeGuard, type RouteKit } from '../declare.ts';
import { errorResponses, jsonBody, jsonOk, noContent } from './common.ts';

const idemHeaders = z.object({ 'idempotency-key': z.string().min(8).max(128) });

export function registerWorkspaceRoutes(kit: RouteKit): void {
  const svc = kit.deps.services;

  kit.app.openapi(
    createRoute({ middleware: routeGuard(kit, { id: 'workspaces.create', method: 'post', path: '/workspaces', auth: 'session', action: 'workspace:create', resource: 'workspace', tenant: false, idempotent: true }), method: 'post', path: '/workspaces', tags: ['workspaces'], request: { headers: idemHeaders, body: jsonBody(CreateWorkspaceBody) }, responses: { 201: jsonOk(WorkspaceSchema, 'Created'), ...errorResponses } }),
    async (c) => c.json(await svc.workspaces.create(c.get('user'), c.req.valid('json')), 201),
  );

  kit.app.openapi(
    createRoute({ middleware: routeGuard(kit, { id: 'workspaces.list', method: 'get', path: '/workspaces', auth: 'session', action: 'workspace:list', resource: 'workspace', tenant: false }), method: 'get', path: '/workspaces', tags: ['workspaces'], request: { query: PageQuerySchema }, responses: { 200: jsonOk(pageOf(WorkspaceSchema), 'Workspaces of the caller'), ...errorResponses } }),
    async (c) => {
      const q = c.req.valid('query');
      return c.json(await svc.workspaces.list(c.get('user'), q.limit, q.cursor), 200);
    },
  );

  kit.app.openapi(
    createRoute({ middleware: routeGuard(kit, { id: 'workspaces.get', method: 'get', path: '/workspaces/{ws}', auth: 'session', action: 'workspace:read', resource: 'workspace', tenant: true }), method: 'get', path: '/workspaces/{ws}', tags: ['workspaces'], request: { params: WorkspaceParams }, responses: { 200: jsonOk(WorkspaceSchema, 'Workspace'), ...errorResponses } }),
    async (c) => c.json(await svc.workspaces.get(c.get('tenant')), 200),
  );

  kit.app.openapi(
    createRoute({ middleware: routeGuard(kit, { id: 'workspaces.update', method: 'patch', path: '/workspaces/{ws}', auth: 'session', action: 'workspace:update', resource: 'workspace', tenant: true, idempotent: false }), method: 'patch', path: '/workspaces/{ws}', tags: ['workspaces'], request: { params: WorkspaceParams, body: jsonBody(UpdateWorkspaceBody) }, responses: { 200: jsonOk(WorkspaceSchema, 'Updated'), ...errorResponses } }),
    async (c) => c.json(await svc.workspaces.update(c.get('tenant'), c.req.valid('json')), 200),
  );

  kit.app.openapi(
    createRoute({ middleware: routeGuard(kit, { id: 'workspaces.delete', method: 'delete', path: '/workspaces/{ws}', auth: 'session', action: 'workspace:delete', resource: 'workspace', tenant: true }), method: 'delete', path: '/workspaces/{ws}', tags: ['workspaces'], request: { params: WorkspaceParams }, responses: { 204: noContent, ...errorResponses } }),
    async (c) => {
      await svc.workspaces.softDelete(c.get('tenant'));
      return c.body(null, 204);
    },
  );

  kit.app.openapi(
    createRoute({ middleware: routeGuard(kit, { id: 'workspaces.transfer_ownership', method: 'post', path: '/workspaces/{ws}/transfer-ownership', auth: 'session', action: 'workspace:transfer_ownership', resource: 'workspace', tenant: true, idempotent: true }), method: 'post', path: '/workspaces/{ws}/transfer-ownership', tags: ['workspaces'], request: { params: WorkspaceParams, headers: idemHeaders, body: jsonBody(TransferOwnershipBody) }, responses: { 204: noContent, ...errorResponses } }),
    async (c) => {
      await svc.members.transferOwnership(c.get('tenant'), c.req.valid('json').new_owner_user_id);
      return c.body(null, 204);
    },
  );

  kit.app.openapi(
    createRoute({ middleware: routeGuard(kit, { id: 'members.list', method: 'get', path: '/workspaces/{ws}/members', auth: 'session', action: 'member:read', resource: 'member', tenant: true }), method: 'get', path: '/workspaces/{ws}/members', tags: ['members'], request: { params: WorkspaceParams, query: PageQuerySchema }, responses: { 200: jsonOk(pageOf(MemberSchema), 'Members'), ...errorResponses } }),
    async (c) => {
      const q = c.req.valid('query');
      return c.json(await svc.members.list(c.get('tenant'), q.limit, q.cursor), 200);
    },
  );

  kit.app.openapi(
    createRoute({ middleware: routeGuard(kit, { id: 'members.update_role', method: 'patch', path: '/workspaces/{ws}/members/{user_id}', auth: 'session', action: 'member:update_role', resource: 'member', tenant: true, idempotent: false }), method: 'patch', path: '/workspaces/{ws}/members/{user_id}', tags: ['members'], request: { params: MemberParams, body: jsonBody(UpdateMemberRoleBody) }, responses: { 204: noContent, ...errorResponses } }),
    async (c) => {
      await svc.members.changeRole(c.get('tenant'), c.req.valid('param').user_id, c.req.valid('json').role);
      return c.body(null, 204);
    },
  );

  kit.app.openapi(
    createRoute({ middleware: routeGuard(kit, { id: 'members.remove', method: 'delete', path: '/workspaces/{ws}/members/{user_id}', auth: 'session', action: 'member:remove', resource: 'member', tenant: true }), method: 'delete', path: '/workspaces/{ws}/members/{user_id}', tags: ['members'], request: { params: MemberParams }, responses: { 204: noContent, ...errorResponses } }),
    async (c) => {
      await svc.members.remove(c.get('tenant'), c.req.valid('param').user_id);
      return c.body(null, 204);
    },
  );

  kit.app.openapi(
    createRoute({ middleware: routeGuard(kit, { id: 'invitations.create', method: 'post', path: '/workspaces/{ws}/invitations', auth: 'session', action: 'invitation:create', resource: 'invitation', tenant: true, idempotent: true }), method: 'post', path: '/workspaces/{ws}/invitations', tags: ['invitations'], request: { params: WorkspaceParams, headers: idemHeaders, body: jsonBody(CreateInvitationBody) }, responses: { 201: jsonOk(InvitationSchema, 'Created (the token is delivered by e-mail only)'), ...errorResponses } }),
    async (c) => c.json(await svc.invitations.create(c.get('tenant'), c.req.valid('json')), 201),
  );

  kit.app.openapi(
    createRoute({ middleware: routeGuard(kit, { id: 'invitations.list', method: 'get', path: '/workspaces/{ws}/invitations', auth: 'session', action: 'invitation:read', resource: 'invitation', tenant: true }), method: 'get', path: '/workspaces/{ws}/invitations', tags: ['invitations'], request: { params: WorkspaceParams, query: PageQuerySchema }, responses: { 200: jsonOk(pageOf(InvitationSchema), 'Invitations'), ...errorResponses } }),
    async (c) => {
      const q = c.req.valid('query');
      return c.json(await svc.invitations.list(c.get('tenant'), q.limit, q.cursor), 200);
    },
  );

  kit.app.openapi(
    createRoute({ middleware: routeGuard(kit, { id: 'invitations.revoke', method: 'delete', path: '/workspaces/{ws}/invitations/{invitation_id}', auth: 'session', action: 'invitation:revoke', resource: 'invitation', tenant: true }), method: 'delete', path: '/workspaces/{ws}/invitations/{invitation_id}', tags: ['invitations'], request: { params: InvitationParams }, responses: { 204: noContent, ...errorResponses } }),
    async (c) => {
      await svc.invitations.revoke(c.get('tenant'), c.req.valid('param').invitation_id);
      return c.body(null, 204);
    },
  );

  kit.app.openapi(
    createRoute({ middleware: routeGuard(kit, { id: 'invitations.accept', method: 'post', path: '/invitations/accept', auth: 'session', action: 'invitation:accept', resource: 'invitation', tenant: false, idempotent: false }), method: 'post', path: '/invitations/accept', tags: ['invitations'], request: { body: jsonBody(AcceptInvitationBody) },
      responses: { 200: jsonOk(z.object({ workspace_id: z.string(), role: z.string() }), 'Joined'), ...errorResponses }, }),
    async (c) => {
      const r = await svc.invitations.accept(c.get('user'), c.req.valid('json').token);
      return c.json({ workspace_id: r.workspaceId, role: r.role }, 200);
    },
  );

  kit.app.openapi(
    createRoute({ middleware: routeGuard(kit, { id: 'audit.list', method: 'get', path: '/workspaces/{ws}/audit-logs', auth: 'session', action: 'audit_log:read', resource: 'audit_log', tenant: true }), method: 'get', path: '/workspaces/{ws}/audit-logs', tags: ['audit'], request: { params: WorkspaceParams, query: PageQuerySchema }, responses: { 200: jsonOk(pageOf(AuditLogSchema), 'Audit log'), ...errorResponses } }),
    async (c) => {
      const q = c.req.valid('query');
      return c.json(await svc.audit.list(c.get('tenant'), q.limit, q.cursor), 200);
    },
  );
}
