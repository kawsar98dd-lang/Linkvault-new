import { z } from 'zod';
import { ASSIGNABLE_ROLES, ERROR_CODES, ROLES, WORKSPACE_STATUSES } from './domain.ts';

export const WORKSPACE_PUBLIC_ID_RE = /^ws_[a-z0-9]{20}$/;
export const WorkspacePublicId = z.string().regex(WORKSPACE_PUBLIC_ID_RE);

export const RoleSchema = z.enum(ROLES);
export const AssignableRoleSchema = z.enum(ASSIGNABLE_ROLES);
export const WorkspaceStatusSchema = z.enum(WORKSPACE_STATUSES);
export const UuidSchema = z.string().uuid();
export const UserIdSchema = z.string().min(1).max(128);
export const IsoDateSchema = z.string().datetime({ offset: true });

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
export const WorkspaceNameSchema = z.string().trim().min(1).max(80);
export const WorkspaceSlugSchema = z.string().regex(SLUG_RE);

/* ---------- Problem+JSON (RFC 9457) ---------- */
export const ProblemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: z.enum(ERROR_CODES),
  detail: z.string().optional(),
  instance: z.string().optional(),
  request_id: z.string(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
export type Problem = z.infer<typeof ProblemSchema>;

/* ---------- Pagination ---------- */
export const PAGE_LIMIT_DEFAULT = 25;
export const PAGE_LIMIT_MAX = 100;
export const PageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(PAGE_LIMIT_MAX).default(PAGE_LIMIT_DEFAULT),
  cursor: z.string().min(1).max(512).optional(),
});
export const pageOf = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ data: z.array(item), next_cursor: z.string().nullable() });

/* ---------- Workspaces ---------- */
export const WorkspaceSchema = z.object({
  id: z.string().regex(WORKSPACE_PUBLIC_ID_RE),
  name: z.string(),
  slug: z.string(),
  status: WorkspaceStatusSchema,
  role: RoleSchema,
  default_locale: z.string(),
  timezone: z.string(),
  created_at: IsoDateSchema,
});
export type WorkspaceDto = z.infer<typeof WorkspaceSchema>;

export const CreateWorkspaceBody = z.object({
  name: WorkspaceNameSchema,
  slug: WorkspaceSlugSchema,
  default_locale: z.enum(['en', 'bn']).default('en'),
  timezone: z.string().min(1).max(64).default('UTC'),
});
export const UpdateWorkspaceBody = z
  .object({
    name: WorkspaceNameSchema.optional(),
    default_locale: z.enum(['en', 'bn']).optional(),
    timezone: z.string().min(1).max(64).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field is required' });

export const WorkspaceParams = z.object({ ws: z.string().regex(WORKSPACE_PUBLIC_ID_RE) });

/* ---------- Members ---------- */
export const MemberSchema = z.object({
  user_id: z.string(),
  name: z.string(),
  email: z.string(),
  role: RoleSchema,
  joined_at: IsoDateSchema,
});
export type MemberDto = z.infer<typeof MemberSchema>;
export const MemberParams = WorkspaceParams.extend({ user_id: UserIdSchema });
export const UpdateMemberRoleBody = z.object({ role: AssignableRoleSchema }).strict();
export const TransferOwnershipBody = z.object({ new_owner_user_id: UserIdSchema }).strict();

/* ---------- Invitations ---------- */
export const InvitationSchema = z.object({
  id: UuidSchema,
  email: z.string(),
  role: AssignableRoleSchema,
  status: z.enum(['pending', 'accepted', 'revoked', 'expired']),
  expires_at: IsoDateSchema,
  created_at: IsoDateSchema,
});
export type InvitationDto = z.infer<typeof InvitationSchema>;
export const CreateInvitationBody = z
  .object({ email: z.string().trim().toLowerCase().email().max(254), role: AssignableRoleSchema })
  .strict();
export const InvitationParams = WorkspaceParams.extend({ invitation_id: UuidSchema });
export const AcceptInvitationBody = z.object({ token: z.string().min(32).max(128) }).strict();

/* ---------- Audit ---------- */
export const AuditLogSchema = z.object({
  id: UuidSchema,
  ts: IsoDateSchema,
  actor_type: z.enum(['user', 'system', 'staff']),
  actor_id: z.string().nullable(),
  action: z.string(),
  resource_type: z.string(),
  resource_id: z.string().nullable(),
  request_id: z.string().nullable(),
  metadata: z.record(z.unknown()),
});
export type AuditLogDto = z.infer<typeof AuditLogSchema>;

/* ---------- Sessions / identity ---------- */
export const SessionViewSchema = z.object({
  id: z.string(),
  created_at: IsoDateSchema,
  expires_at: IsoDateSchema,
  user_agent: z.string().nullable(),
  current: z.boolean(),
});
export type SessionView = z.infer<typeof SessionViewSchema>;
export const SessionParams = z.object({ session_id: z.string().min(1).max(128) });

export const MeSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  email_verified: z.boolean(),
  two_factor_enabled: z.boolean(),
});
export const CsrfTokenSchema = z.object({ csrf_token: z.string() });
