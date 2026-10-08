import type { AssignableRole, InvitationDto } from '@bnlinkvault/contracts';
import { can, type Actor } from '@bnlinkvault/auth/policy';
import { schema, rebindWorkspace, withTenant, withUser, type Database } from '@bnlinkvault/db';
import { t, isLocale, type Locale } from '@bnlinkvault/i18n';
import { and, desc, eq, sql } from 'drizzle-orm';
import { recordAudit } from '../audit.ts';
import type { Clock, UserCtx, WorkspaceCtx } from '../context.ts';
import { conflict, forbidden, notFound, pgErrorCode, pgErrorMessage } from '../errors.ts';
import { hashToken, newOpaqueToken } from '../ids.ts';
import type { Mailer } from '../mail/mailer.ts';
import type { Logger } from '../observability/logger.ts';
import { enqueueOutbox } from '../outbox.ts';
import { decodeCursor, toPage, type Page } from '../pagination.ts';

export const INVITATION_TTL_MS = 7 * 24 * 3600 * 1000;

const actorOf = (ctx: WorkspaceCtx): Actor => ({ userId: ctx.userId, emailVerified: ctx.emailVerified, workspaceId: ctx.workspaceId, role: ctx.role });

type Row = typeof schema.invitations.$inferSelect;
const toDto = (r: Row, now: Date): InvitationDto => ({
  id: r.id,
  email: r.email,
  role: r.role,
  status: r.status === 'pending' && r.expiresAt <= now ? 'expired' : r.status,
  expires_at: r.expiresAt.toISOString(),
  created_at: r.createdAt.toISOString(),
});

export interface InvitationDeps {
  db: Database;
  clock: Clock;
  mailer: Mailer;
  logger: Logger;
  appUrl: string;
}

export class InvitationService {
  private readonly d: InvitationDeps;

  constructor(d: InvitationDeps) {
    this.d = d;
  }

  async create(ctx: WorkspaceCtx, input: { email: string; role: AssignableRole }): Promise<InvitationDto> {
    const decision = can(actorOf(ctx), 'invitation:create', {
      type: 'invitation', workspaceId: ctx.workspaceId, workspaceStatus: ctx.workspaceStatus, invitedRole: input.role,
    });
    if (!decision.allowed) throw forbidden(`denied: ${decision.reason}`);

    const token = newOpaqueToken();
    const now = this.d.clock.now();
    let created: Row;
    let workspaceName = '';
    let locale: Locale = 'en';
    try {
      created = await withTenant(this.d.db, { userId: ctx.userId, workspaceId: ctx.workspaceId, requestId: ctx.requestId }, async (tx) => {
        const [ws] = await tx.select({ name: schema.workspaces.name, locale: schema.workspaces.defaultLocale }).from(schema.workspaces).where(eq(schema.workspaces.id, ctx.workspaceId));
        workspaceName = ws?.name ?? '';
        locale = ws && isLocale(ws.locale) ? ws.locale : 'en';
        const [row] = await tx
          .insert(schema.invitations)
          .values({ workspaceId: ctx.workspaceId, email: input.email, role: input.role, tokenHash: hashToken(token), invitedBy: ctx.userId, expiresAt: new Date(now.getTime() + INVITATION_TTL_MS) })
          .returning();
        if (!row) throw new Error('invitation insert returned no row');
        await recordAudit(tx, {
          workspaceId: ctx.workspaceId, actorType: 'user', actorId: ctx.userId, action: 'invitation.created',
          resourceType: 'invitation', resourceId: row.id, requestId: ctx.requestId, metadata: { role: input.role },
        });
        await enqueueOutbox(tx, { workspaceId: ctx.workspaceId, aggregateType: 'invitation', aggregateId: row.id, eventType: 'invitation.created', payload: { role: input.role } });
        return row;
      });
    } catch (error) {
      if (pgErrorCode(error) === '23505') throw conflict('a pending invitation already exists for this email');
      throw error;
    }

    // The raw token leaves the system ONLY through the email channel (never API responses/logs/audit).
    const url = `${this.d.appUrl.replace(/\/$/, '')}/invitations/accept#token=${token}`;
    try {
      await this.d.mailer.send({
        to: input.email,
        subject: t(locale, 'email.invite.subject', { workspace: workspaceName }),
        text: t(locale, 'email.invite.body', { inviter: ctx.name, workspace: workspaceName, role: input.role, url }),
      });
    } catch (error) {
      this.d.logger.error('invitation email failed', { invitation_id: created.id, request_id: ctx.requestId, error });
    }
    return toDto(created, now);
  }

  async list(ctx: WorkspaceCtx, limit: number, rawCursor: string | undefined): Promise<Page<InvitationDto>> {
    const cursor = decodeCursor(rawCursor);
    const now = this.d.clock.now();
    const rows = await withTenant(this.d.db, { userId: ctx.userId, workspaceId: ctx.workspaceId, requestId: ctx.requestId }, (tx) =>
      tx
        .select()
        .from(schema.invitations)
        .where(and(eq(schema.invitations.workspaceId, ctx.workspaceId), cursor ? sql`(${schema.invitations.createdAt}, ${schema.invitations.id}) < (${cursor.t}::timestamptz, ${cursor.id}::uuid)` : undefined))
        .orderBy(desc(schema.invitations.createdAt), desc(schema.invitations.id))
        .limit(limit + 1),
    );
    const page = toPage(rows, limit, (r) => ({ t: r.createdAt.toISOString(), id: r.id }));
    return { data: page.data.map((r) => toDto(r, now)), next_cursor: page.next_cursor };
  }

  async revoke(ctx: WorkspaceCtx, invitationId: string): Promise<void> {
    await withTenant(this.d.db, { userId: ctx.userId, workspaceId: ctx.workspaceId, requestId: ctx.requestId }, async (tx) => {
      const updated = await tx
        .update(schema.invitations)
        .set({ status: 'revoked' })
        .where(and(eq(schema.invitations.id, invitationId), eq(schema.invitations.workspaceId, ctx.workspaceId), eq(schema.invitations.status, 'pending')))
        .returning({ id: schema.invitations.id });
      if (updated.length === 0) throw notFound();
      await recordAudit(tx, {
        workspaceId: ctx.workspaceId, actorType: 'user', actorId: ctx.userId, action: 'invitation.revoked',
        resourceType: 'invitation', resourceId: invitationId, requestId: ctx.requestId,
      });
      await enqueueOutbox(tx, { workspaceId: ctx.workspaceId, aggregateType: 'invitation', aggregateId: invitationId, eventType: 'invitation.revoked', payload: {} });
    });
  }

  /**
   * Accept by token. Requires a verified email (checked by `can` in the API layer and again here).
   * All failure modes are reported as the SAME not_found so tokens cannot be probed.
   */
  async accept(ctx: UserCtx, token: string): Promise<{ workspaceId: string; role: AssignableRole }> {
    if (!ctx.emailVerified) throw forbidden('email not verified');
    try {
      return await withUser(this.d.db, { userId: ctx.userId, requestId: ctx.requestId }, async (tx) => {
        const res = await tx.execute<{ out_workspace_id: string; out_role: AssignableRole }>(
          sql`select * from app.accept_invitation(${hashToken(token)}, ${ctx.userId}, ${ctx.email})`,
        );
        const row = res.rows[0];
        if (!row) throw notFound();
        await rebindWorkspace(tx, { userId: ctx.userId, workspaceId: row.out_workspace_id });
        const [ws] = await tx.select({ publicId: schema.workspaces.publicId }).from(schema.workspaces).where(eq(schema.workspaces.id, row.out_workspace_id));
        await recordAudit(tx, {
          workspaceId: row.out_workspace_id, actorType: 'user', actorId: ctx.userId, action: 'invitation.accepted',
          resourceType: 'invitation', resourceId: null, requestId: ctx.requestId, metadata: { role: row.out_role },
        });
        await enqueueOutbox(tx, { workspaceId: row.out_workspace_id, aggregateType: 'member', aggregateId: ctx.userId, eventType: 'member.joined', payload: { role: row.out_role } });
        return { workspaceId: ws?.publicId ?? row.out_workspace_id, role: row.out_role };
      });
    } catch (error) {
      const message = pgErrorMessage(error);
      if (message.includes('already_member')) throw conflict('already a member');
      if (message.includes('invitation_invalid')) throw notFound('invalid invitation');
      throw error;
    }
  }
}
