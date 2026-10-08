import { ACTION_RESOURCE, type Action, type Role } from '@bnlinkvault/contracts/domain';
import { PERMISSION_MATRIX } from './matrix.ts';
import type { Actor, Decision, DenyReason, ResourceRef } from './types.ts';

const allow: Decision = { allowed: true };
const deny = (reason: DenyReason): Decision => ({ allowed: false, reason });

const LOW_ROLES: readonly Role[] = ['editor', 'viewer'];
const isLow = (r: Role | undefined): boolean => r !== undefined && LOW_ROLES.includes(r);

/** Fine-grained, target-dependent rules. Only evaluated after the coarse matrix check passes. */
function refine(actor: Actor, action: Action, res: ResourceRef): Decision {
  switch (action) {
    case 'member:update_role': {
      if (!res.targetRole || !res.newRole || !res.targetUserId) return deny('invalid_target');
      if (res.targetUserId === actor.userId) return deny('self_change');
      if (res.targetRole === 'owner') return deny('owner_immutable');
      if (res.newRole === 'owner') return deny('owner_via_transfer_only');
      if (actor.role === 'admin' && !(isLow(res.targetRole) && isLow(res.newRole))) {
        return deny('role_hierarchy');
      }
      return allow;
    }
    case 'member:remove': {
      if (!res.targetRole || !res.targetUserId) return deny('invalid_target');
      if (res.targetUserId === actor.userId) return deny('self_change');
      if (res.targetRole === 'owner') return deny('owner_immutable');
      if (actor.role === 'admin' && !isLow(res.targetRole)) return deny('role_hierarchy');
      return allow;
    }
    case 'invitation:create': {
      if (!res.invitedRole) return deny('invalid_target');
      if (res.invitedRole === 'owner') return deny('owner_via_transfer_only');
      if (actor.role === 'admin' && !isLow(res.invitedRole)) return deny('role_hierarchy');
      return allow;
    }
    case 'workspace:transfer_ownership': {
      if (!res.targetUserId) return deny('invalid_target');
      if (res.targetUserId === actor.userId) return deny('self_change');
      return allow;
    }
    default:
      return allow;
  }
}

function evaluate(actor: Actor | null, action: Action, resource: ResourceRef, withRefinements: boolean): Decision {
  if (!actor || actor.userId.length === 0) return deny('unauthenticated');

  const spec = PERMISSION_MATRIX[action];
  if (spec.requiresVerifiedEmail && !actor.emailVerified) return deny('email_not_verified');
  if (ACTION_RESOURCE[action] !== resource.type) return deny('resource_mismatch');

  if (spec.scope === 'user') return allow;

  if (!resource.workspaceId || actor.workspaceId !== resource.workspaceId) return deny('tenant_mismatch');
  if (!actor.role) return deny('not_a_member');
  if (!spec.roles.includes(actor.role)) return deny('insufficient_role');
  if (spec.mutating && resource.workspaceStatus !== undefined && resource.workspaceStatus !== 'active') {
    return deny('workspace_not_active');
  }
  return withRefinements ? refine(actor, action, resource) : allow;
}

/**
 * Central authorization decision. Pure and deterministic: no I/O.
 * Callers must load `actor` (membership/role) and `resource` facts from trusted server-side state.
 * Default is deny; every allow path is explicit.
 */
export function can(actor: Actor | null, action: Action, resource: ResourceRef): Decision {
  return evaluate(actor, action, resource, true);
}

/**
 * Coarse gate used by the API middleware BEFORE target facts are loaded (role/tenant/status only).
 * Handlers/services must then call can() with the target facts for the fine-grained decision.
 */
export function canCoarse(actor: Actor | null, action: Action, resource: ResourceRef): Decision {
  return evaluate(actor, action, resource, false);
}
