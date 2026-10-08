import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Drizzle mirror of migrations/*.sql (SQL is the source of truth: it carries RLS, roles, triggers).
 * `test/schema-parity.int.test.ts` fails CI if this file and the real database diverge.
 * Object keys for the auth tables (`user`, `session`, `account`, `verification`, `twoFactor`) are the
 * model names Better Auth expects; physical table names follow the platform's plural convention.
 */
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const user = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const session = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    expiresAt: ts('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [index('sessions_user_id_idx').on(t.userId), index('sessions_expires_at_idx').on(t.expiresAt)],
);

export const account = pgTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: ts('access_token_expires_at'),
    refreshTokenExpiresAt: ts('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('accounts_user_id_idx').on(t.userId)],
);

export const verification = pgTable(
  'verifications',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: ts('expires_at').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('verifications_identifier_idx').on(t.identifier)],
);

export const twoFactor = pgTable(
  'two_factors',
  {
    id: text('id').primaryKey(),
    secret: text('secret').notNull(),
    backupCodes: text('backup_codes').notNull(),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [index('two_factors_user_id_idx').on(t.userId)],
);

export const workspaces = pgTable(
  'workspaces',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    publicId: text('public_id').notNull().unique(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    ownerUserId: text('owner_user_id').notNull().references(() => user.id, { onDelete: 'restrict' }),
    status: text('status', { enum: ['active', 'suspended', 'deleting'] }).notNull().default('active'),
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    defaultLocale: text('default_locale').notNull().default('en'),
    timezone: text('timezone').notNull().default('UTC'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    deletedAt: ts('deleted_at'),
  },
  (t) => [
    uniqueIndex('workspaces_slug_active_key').on(t.slug).where(sql`${t.deletedAt} IS NULL`),
    index('workspaces_owner_idx').on(t.ownerUserId),
  ],
);

export const memberships = pgTable(
  'memberships',
  {
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['owner', 'admin', 'editor', 'viewer'] }).notNull(),
    status: text('status', { enum: ['active', 'removed'] }).notNull().default('active'),
    invitedBy: text('invited_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId] }),
    uniqueIndex('memberships_one_active_owner').on(t.workspaceId).where(sql`${t.role} = 'owner' AND ${t.status} = 'active'`),
    index('memberships_user_active_idx').on(t.userId).where(sql`${t.status} = 'active'`),
  ],
);

export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role', { enum: ['admin', 'editor', 'viewer'] }).notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    invitedBy: text('invited_by').notNull().references(() => user.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['pending', 'accepted', 'revoked', 'expired'] }).notNull().default('pending'),
    expiresAt: ts('expires_at').notNull(),
    acceptedBy: text('accepted_by').references(() => user.id, { onDelete: 'set null' }),
    acceptedAt: ts('accepted_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('invitations_pending_email_key').on(t.workspaceId, t.email).where(sql`${t.status} = 'pending'`),
    index('invitations_workspace_idx').on(t.workspaceId, t.createdAt.desc()),
  ],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    ts: ts('ts').notNull().defaultNow(),
    workspaceId: uuid('workspace_id'),
    actorType: text('actor_type', { enum: ['user', 'system', 'staff'] }).notNull(),
    actorId: text('actor_id'),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id'),
    requestId: text('request_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    index('audit_logs_workspace_ts_idx').on(t.workspaceId, t.ts.desc(), t.id.desc()),
    index('audit_logs_actor_ts_idx').on(t.actorId, t.ts.desc()),
  ],
);

export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id'),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: text('aggregate_id').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: text('status', { enum: ['pending', 'processing', 'published', 'failed'] }).notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    nextAttemptAt: ts('next_attempt_at').notNull().defaultNow(),
    createdAt: ts('created_at').notNull().defaultNow(),
    publishedAt: ts('published_at'),
  },
  (t) => [
    index('outbox_pending_idx').on(t.nextAttemptAt).where(sql`${t.status} IN ('pending', 'failed')`),
    index('outbox_workspace_idx').on(t.workspaceId, t.createdAt.desc()),
  ],
);

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    actorUserId: text('actor_user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id'),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    status: text('status', { enum: ['in_progress', 'completed'] }).notNull().default('in_progress'),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body').$type<unknown>(),
    lockedAt: ts('locked_at').notNull().defaultNow(),
    createdAt: ts('created_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
  },
  (t) => [
    uniqueIndex('idempotency_scope_key').on(
      t.actorUserId,
      sql`COALESCE(${t.workspaceId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      t.key,
    ),
    index('idempotency_expires_idx').on(t.expiresAt),
  ],
);
