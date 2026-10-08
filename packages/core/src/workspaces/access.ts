import type { Role, WorkspaceStatus } from '@bnlinkvault/contracts';
import { schema, withUser, type Database } from '@bnlinkvault/db';
import { and, eq, isNull } from 'drizzle-orm';

export interface ResolvedWorkspace {
  id: string;
  publicId: string;
  status: WorkspaceStatus;
  role: Role;
  defaultLocale: string;
}

/**
 * Resolves a public workspace id to (internal id, caller's role). Returns null both when the
 * workspace does not exist AND when the caller is not an active member: callers must answer 404 in
 * both cases so that existence is never disclosed (anti-IDOR). RLS independently hides non-member rows.
 */
export async function resolveWorkspaceForUser(db: Database, userId: string, publicId: string): Promise<ResolvedWorkspace | null> {
  return withUser(db, { userId }, async (tx) => {
    const [row] = await tx
      .select({
        id: schema.workspaces.id,
        publicId: schema.workspaces.publicId,
        status: schema.workspaces.status,
        role: schema.memberships.role,
        defaultLocale: schema.workspaces.defaultLocale,
      })
      .from(schema.workspaces)
      .innerJoin(
        schema.memberships,
        and(
          eq(schema.memberships.workspaceId, schema.workspaces.id),
          eq(schema.memberships.userId, userId),
          eq(schema.memberships.status, 'active'),
        ),
      )
      .where(and(eq(schema.workspaces.publicId, publicId), isNull(schema.workspaces.deletedAt)))
      .limit(1);
    return row ?? null;
  });
}
