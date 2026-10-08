/** Shared domain vocabulary. No runtime dependencies: safe for every package. */

export const ROLES = ['owner', 'admin', 'editor', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

/** Roles that may be granted through invitations / role changes (never `owner`: use transfer). */
export const ASSIGNABLE_ROLES = ['admin', 'editor', 'viewer'] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export const RESOURCE_TYPES = ['user', 'session', 'workspace', 'member', 'invitation', 'audit_log', 'csrf'] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

/** Every authorizable action in Phase 2. Format: `<resource>:<verb>`. */
export const ACTIONS = [
  'user:read_self',
  'csrf:issue',
  'session:list',
  'session:revoke',
  'workspace:create',
  'workspace:list',
  'workspace:read',
  'workspace:update',
  'workspace:delete',
  'workspace:transfer_ownership',
  'member:read',
  'member:update_role',
  'member:remove',
  'invitation:create',
  'invitation:read',
  'invitation:revoke',
  'invitation:accept',
  'audit_log:read',
] as const;
export type Action = (typeof ACTIONS)[number];

export const ACTION_RESOURCE: Readonly<Record<Action, ResourceType>> = {
  'user:read_self': 'user',
  'csrf:issue': 'csrf',
  'session:list': 'session',
  'session:revoke': 'session',
  'workspace:create': 'workspace',
  'workspace:list': 'workspace',
  'workspace:read': 'workspace',
  'workspace:update': 'workspace',
  'workspace:delete': 'workspace',
  'workspace:transfer_ownership': 'workspace',
  'member:read': 'member',
  'member:update_role': 'member',
  'member:remove': 'member',
  'invitation:create': 'invitation',
  'invitation:read': 'invitation',
  'invitation:revoke': 'invitation',
  'invitation:accept': 'invitation',
  'audit_log:read': 'audit_log',
};

export const WORKSPACE_STATUSES = ['active', 'suspended', 'deleting'] as const;
export type WorkspaceStatus = (typeof WORKSPACE_STATUSES)[number];

export const ERROR_CODES = [
  'validation_failed',
  'unauthenticated',
  'email_not_verified',
  'forbidden',
  'not_found',
  'conflict',
  'idempotency_key_reuse',
  'idempotency_in_progress',
  'rate_limited',
  'csrf_failed',
  'captcha_failed',
  'internal_error',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
