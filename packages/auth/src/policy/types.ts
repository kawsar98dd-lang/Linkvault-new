import type { ResourceType, Role, WorkspaceStatus } from '@bnlinkvault/contracts/domain';

/** The authenticated principal, already resolved server-side. `role` is the role IN `workspaceId`. */
export interface Actor {
  userId: string;
  emailVerified: boolean;
  workspaceId: string | null;
  role: Role | null;
}

export interface ResourceRef {
  type: ResourceType;
  workspaceId?: string | null;
  workspaceStatus?: WorkspaceStatus;
  /** For member/ownership actions. */
  targetUserId?: string;
  targetRole?: Role;
  newRole?: Role;
  /** For invitation creation. */
  invitedRole?: Role;
}

export type DenyReason =
  | 'unauthenticated'
  | 'email_not_verified'
  | 'resource_mismatch'
  | 'tenant_mismatch'
  | 'not_a_member'
  | 'insufficient_role'
  | 'workspace_not_active'
  | 'invalid_target'
  | 'owner_immutable'
  | 'owner_via_transfer_only'
  | 'self_change'
  | 'role_hierarchy';

export type Decision = { allowed: true } | { allowed: false; reason: DenyReason };
