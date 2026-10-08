import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  ACTION_RESOURCE,
  CreateInvitationBody,
  CreateWorkspaceBody,
  PageQuerySchema,
  UpdateWorkspaceBody,
  WORKSPACE_PUBLIC_ID_RE,
} from '../src/index.ts';

describe('contracts', () => {
  it('maps every action to a resource', () => {
    for (const a of ACTIONS) expect(ACTION_RESOURCE[a]).toBeTypeOf('string');
    expect(Object.keys(ACTION_RESOURCE).sort()).toEqual([...ACTIONS].sort());
  });
  it('validates workspace public ids', () => {
    expect(WORKSPACE_PUBLIC_ID_RE.test('ws_abcdefghij0123456789')).toBe(true);
    expect(WORKSPACE_PUBLIC_ID_RE.test('ws_short')).toBe(false);
    expect(WORKSPACE_PUBLIC_ID_RE.test('1; DROP TABLE')).toBe(false);
  });
  it('rejects owner role in invitations and unknown keys', () => {
    expect(CreateInvitationBody.safeParse({ email: 'A@B.com', role: 'owner' }).success).toBe(false);
    expect(CreateInvitationBody.safeParse({ email: 'A@B.com', role: 'admin', x: 1 }).success).toBe(false);
    expect(CreateInvitationBody.parse({ email: ' A@B.com ', role: 'viewer' }).email).toBe('a@b.com');
  });
  it('validates workspace creation and update', () => {
    expect(CreateWorkspaceBody.safeParse({ name: 'Acme', slug: 'acme' }).success).toBe(true);
    expect(CreateWorkspaceBody.safeParse({ name: 'Acme', slug: '-bad-' }).success).toBe(false);
    expect(UpdateWorkspaceBody.safeParse({}).success).toBe(false);
    expect(UpdateWorkspaceBody.safeParse({ slug: 'x' }).success).toBe(false);
  });
  it('bounds pagination', () => {
    expect(PageQuerySchema.parse({}).limit).toBe(25);
    expect(PageQuerySchema.safeParse({ limit: '1000' }).success).toBe(false);
  });
});
