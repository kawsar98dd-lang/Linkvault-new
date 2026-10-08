import { z } from 'zod';
import type { AuthPort, SessionInfo, SessionSummary } from '../port.ts';
import type { BetterAuthInstance } from './create-auth.ts';

const SessionResult = z.object({
  session: z.object({ id: z.string(), expiresAt: z.coerce.date() }),
  user: z.object({
    id: z.string(),
    email: z.string(),
    name: z.string(),
    emailVerified: z.boolean(),
    twoFactorEnabled: z.boolean().nullish(),
  }),
});

const SessionRow = z.object({
  id: z.string(),
  token: z.string(),
  createdAt: z.coerce.date(),
  expiresAt: z.coerce.date(),
  userAgent: z.string().nullish(),
});

/**
 * AuthPort implemented on Better Auth. Provider outputs are parsed with zod at this boundary so
 * the rest of the platform only ever sees our own types, and session TOKENS never leave this file.
 */
export class BetterAuthAdapter implements AuthPort {
  private readonly auth: BetterAuthInstance;

  constructor(auth: BetterAuthInstance) {
    this.auth = auth;
  }

  async getSession(headers: Headers): Promise<SessionInfo | null> {
    const raw: unknown = await this.auth.api.getSession({ headers });
    if (raw === null || raw === undefined) return null;
    const parsed = SessionResult.safeParse(raw);
    if (!parsed.success) return null; // unknown shape => treat as unauthenticated (fail closed)
    const { session, user } = parsed.data;
    return {
      sessionId: session.id,
      userId: user.id,
      email: user.email,
      name: user.name,
      emailVerified: user.emailVerified,
      twoFactorEnabled: user.twoFactorEnabled === true,
      expiresAt: session.expiresAt,
    };
  }

  private async rows(headers: Headers): Promise<z.infer<typeof SessionRow>[]> {
    const raw: unknown = await this.auth.api.listSessions({ headers });
    const parsed = z.array(SessionRow).safeParse(raw);
    return parsed.success ? parsed.data : [];
  }

  async listSessions(headers: Headers): Promise<SessionSummary[]> {
    const current = await this.getSession(headers);
    if (!current) return [];
    return (await this.rows(headers)).map((s) => ({
      id: s.id,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      userAgent: s.userAgent ?? null,
      current: s.id === current.sessionId,
    }));
  }

  async revokeSession(headers: Headers, sessionId: string): Promise<boolean> {
    // listSessions only returns the caller's own sessions, so a foreign id can never match.
    const target = (await this.rows(headers)).find((s) => s.id === sessionId);
    if (!target) return false;
    await this.auth.api.revokeSession({ headers, body: { token: target.token } });
    return true;
  }

  handleRequest(request: Request): Promise<Response> {
    return this.auth.handler(request);
  }
}
