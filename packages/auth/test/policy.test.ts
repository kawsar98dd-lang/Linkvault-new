import { ACTIONS, ACTION_RESOURCE, ROLES, type Action, type Role } from '@bnlinkvault/contracts/domain';
import { describe, expect, it } from 'vitest';
import { PERMISSION_MATRIX, can, canCoarse, type Actor, type ResourceRef } from '../src/policy/index.ts';

const WS = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const actor = (role: Role | null, over: Partial<Actor> = {}): Actor => ({
  userId: 'u1',
  emailVerified: true,
  workspaceId: WS,
  role,
  ...over,
});
const res = (action: Action, over: Partial<ResourceRef> = {}): ResourceRef => ({
  type: ACTION_RESOURCE[action],
  workspaceId: WS,
  workspaceStatus: 'active',
  ...over,
});
const reason = (d: ReturnType<typeof can>): string => (d.allowed ? 'allowed' : d.reason);

describe('can(): base checks', () => {
  it('denies unauthenticated and empty user ids', () => {
    expect(reason(can(null, 'workspace:read', res('workspace:read')))).toBe('unauthenticated');
    expect(reason(can(actor('owner', { userId: '' }), 'workspace:read', res('workspace:read')))).toBe('unauthenticated');
  });
  it('requires a verified email where the matrix says so', () => {
    expect(reason(can(actor('owner', { emailVerified: false }), 'workspace:read', res('workspace:read')))).toBe('email_not_verified');
    expect(reason(can(actor(null, { emailVerified: false, workspaceId: null }), 'user:read_self', { type: 'user' }))).toBe('allowed');
    expect(reason(can(actor(null, { emailVerified: false, workspaceId: null }), 'workspace:create', { type: 'workspace' }))).toBe('email_not_verified');
  });
  it('rejects mismatched resource types', () => {
    expect(reason(can(actor('owner'), 'workspace:read', { type: 'member', workspaceId: WS }))).toBe('resource_mismatch');
  });
  it('allows user-scoped actions without a tenant', () => {
    expect(reason(can(actor(null, { workspaceId: null }), 'session:list', { type: 'session' }))).toBe('allowed');
  });
  it('denies cross-tenant, missing workspace and non-members', () => {
    expect(reason(can(actor('owner'), 'workspace:read', res('workspace:read', { workspaceId: OTHER })))).toBe('tenant_mismatch');
    expect(reason(can(actor('owner'), 'workspace:read', res('workspace:read', { workspaceId: null })))).toBe('tenant_mismatch');
    expect(reason(can(actor('owner'), 'workspace:read', { type: 'workspace' }))).toBe('tenant_mismatch');
    expect(reason(can(actor(null), 'workspace:read', res('workspace:read')))).toBe('not_a_member');
  });
  it('denies mutating actions on non-active workspaces but allows reads', () => {
    expect(reason(can(actor('owner'), 'workspace:update', res('workspace:update', { workspaceStatus: 'suspended' })))).toBe('workspace_not_active');
    expect(reason(can(actor('owner'), 'workspace:read', res('workspace:read', { workspaceStatus: 'suspended' })))).toBe('allowed');
    expect(reason(can(actor('owner'), 'workspace:update', { type: 'workspace', workspaceId: WS }))).toBe('allowed');
  });
});

describe('permission matrix (coarse, every role x every action)', () => {
  for (const action of ACTIONS) {
    const spec = PERMISSION_MATRIX[action];
    if (spec.scope !== 'workspace') continue;
    for (const role of ROLES) {
      it(`${action} for ${role}`, () => {
        // Provide valid fine-grained facts so only the coarse matrix decides.
        const facts: Partial<ResourceRef> = {
          targetUserId: 'u2',
          targetRole: 'viewer',
          newRole: 'editor',
          invitedRole: 'viewer',
        };
        const d = can(actor(role), action, res(action, facts));
        expect(d.allowed).toBe(spec.roles.includes(role));
        if (!d.allowed) expect(d.reason).toBe('insufficient_role');
      });
    }
  }
});

describe('can(): refinements', () => {
  const upd = (a: Role, over: Partial<ResourceRef>) => reason(can(actor(a), 'member:update_role', res('member:update_role', over)));
  it('member:update_role', () => {
    expect(upd('owner', {})).toBe('invalid_target');
    expect(upd('owner', { targetRole: 'viewer', newRole: 'editor' })).toBe('invalid_target');
    expect(upd('owner', { targetUserId: 'u1', targetRole: 'viewer', newRole: 'editor' })).toBe('self_change');
    expect(upd('owner', { targetUserId: 'u2', targetRole: 'owner', newRole: 'editor' })).toBe('owner_immutable');
    expect(upd('owner', { targetUserId: 'u2', targetRole: 'admin', newRole: 'owner' })).toBe('owner_via_transfer_only');
    expect(upd('owner', { targetUserId: 'u2', targetRole: 'admin', newRole: 'viewer' })).toBe('allowed');
    expect(upd('admin', { targetUserId: 'u2', targetRole: 'viewer', newRole: 'editor' })).toBe('allowed');
    expect(upd('admin', { targetUserId: 'u2', targetRole: 'admin', newRole: 'viewer' })).toBe('role_hierarchy');
    expect(upd('admin', { targetUserId: 'u2', targetRole: 'viewer', newRole: 'admin' })).toBe('role_hierarchy');
  });
  const rem = (a: Role, over: Partial<ResourceRef>) => reason(can(actor(a), 'member:remove', res('member:remove', over)));
  it('member:remove', () => {
    expect(rem('owner', {})).toBe('invalid_target');
    expect(rem('owner', { targetUserId: 'u1', targetRole: 'viewer' })).toBe('self_change');
    expect(rem('owner', { targetUserId: 'u2', targetRole: 'owner' })).toBe('owner_immutable');
    expect(rem('owner', { targetUserId: 'u2', targetRole: 'admin' })).toBe('allowed');
    expect(rem('admin', { targetUserId: 'u2', targetRole: 'admin' })).toBe('role_hierarchy');
    expect(rem('admin', { targetUserId: 'u2', targetRole: 'editor' })).toBe('allowed');
  });
  const inv = (a: Role, over: Partial<ResourceRef>) => reason(can(actor(a), 'invitation:create', res('invitation:create', over)));
  it('invitation:create', () => {
    expect(inv('admin', {})).toBe('invalid_target');
    expect(inv('owner', { invitedRole: 'owner' })).toBe('owner_via_transfer_only');
    expect(inv('admin', { invitedRole: 'admin' })).toBe('role_hierarchy');
    expect(inv('admin', { invitedRole: 'editor' })).toBe('allowed');
    expect(inv('owner', { invitedRole: 'admin' })).toBe('allowed');
  });
  const tr = (over: Partial<ResourceRef>) => reason(can(actor('owner'), 'workspace:transfer_ownership', res('workspace:transfer_ownership', over)));
  it('workspace:transfer_ownership', () => {
    expect(tr({})).toBe('invalid_target');
    expect(tr({ targetUserId: 'u1' })).toBe('self_change');
    expect(tr({ targetUserId: 'u2' })).toBe('allowed');
    expect(reason(can(actor('admin'), 'workspace:transfer_ownership', res('workspace:transfer_ownership', { targetUserId: 'u2' })))).toBe('insufficient_role');
  });
});

describe('canCoarse', () => {
  it('ignores target-dependent refinements but keeps role/tenant/status checks', () => {
    expect(reason(canCoarse(actor('admin'), 'member:update_role', res('member:update_role')))).toBe('allowed');
    expect(reason(can(actor('admin'), 'member:update_role', res('member:update_role')))).toBe('invalid_target');
    expect(reason(canCoarse(actor('viewer'), 'member:update_role', res('member:update_role')))).toBe('insufficient_role');
    expect(reason(canCoarse(actor('owner'), 'member:update_role', res('member:update_role', { workspaceId: OTHER })))).toBe('tenant_mismatch');
    expect(reason(canCoarse(null, 'member:update_role', res('member:update_role')))).toBe('unauthenticated');
  });
});
