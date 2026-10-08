import type { Action, Role } from '@bnlinkvault/contracts/domain';

export interface PermissionSpec {
  /** `user`: acts on the caller's own data (no tenant). `workspace`: requires membership. */
  scope: 'user' | 'workspace';
  /** Roles allowed (workspace scope only). */
  roles: readonly Role[];
  requiresVerifiedEmail: boolean;
  /** Mutating actions are denied while the workspace is not `active`. */
  mutating: boolean;
}

const ALL: readonly Role[] = ['owner', 'admin', 'editor', 'viewer'];
const ADMINS: readonly Role[] = ['owner', 'admin'];
const OWNER: readonly Role[] = ['owner'];
const NONE: readonly Role[] = [];

const user = (requiresVerifiedEmail: boolean, mutating: boolean): PermissionSpec => ({
  scope: 'user',
  roles: NONE,
  requiresVerifiedEmail,
  mutating,
});
const ws = (roles: readonly Role[], mutating: boolean): PermissionSpec => ({
  scope: 'workspace',
  roles,
  requiresVerifiedEmail: true,
  mutating,
});

/** Single source of truth for authorization. Mirrored in docs/security/permission-matrix.md. */
export const PERMISSION_MATRIX: Readonly<Record<Action, PermissionSpec>> = {
  'user:read_self': user(false, false),
  'csrf:issue': user(false, false),
  'session:list': user(false, false),
  'session:revoke': user(false, true),
  'workspace:create': user(true, true),
  'workspace:list': user(true, false),
  'workspace:read': ws(ALL, false),
  'workspace:update': ws(ADMINS, true),
  'workspace:delete': ws(OWNER, true),
  'workspace:transfer_ownership': ws(OWNER, true),
  'member:read': ws(ALL, false),
  'member:update_role': ws(ADMINS, true),
  'member:remove': ws(ADMINS, true),
  'invitation:create': ws(ADMINS, true),
  'invitation:read': ws(ADMINS, false),
  'invitation:revoke': ws(ADMINS, true),
  'invitation:accept': user(true, true),
  'audit_log:read': ws(ADMINS, false),
};
