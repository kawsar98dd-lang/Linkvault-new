import type { AuthPort, SessionInfo, SessionSummary } from '@bnlinkvault/auth';

/**
 * Test double for AuthPort, used ONLY by API-layer tests to exercise authorization, tenancy, CSRF,
 * idempotency and error handling without a full login flow. The real Better Auth integration is
 * covered separately (packages/auth integration tests); this fake must never ship in the app.
 * Sessions are selected by the `x-test-session` request header.
 */
export class TestAuthPort implements AuthPort {
  private readonly sessions = new Map<string, SessionInfo>();

  add(session: Partial<SessionInfo> & Pick<SessionInfo, 'sessionId' | 'userId'>): SessionInfo {
    const full: SessionInfo = {
      email: `${session.userId}@example.test`,
      name: session.userId,
      emailVerified: true,
      twoFactorEnabled: false,
      expiresAt: new Date(Date.now() + 3_600_000),
      ...session,
    };
    this.sessions.set(full.sessionId, full);
    return full;
  }

  getSession(headers: Headers): Promise<SessionInfo | null> {
    const id = headers.get('x-test-session');
    const s = id ? this.sessions.get(id) : undefined;
    return Promise.resolve(s && s.expiresAt > new Date() ? s : null);
  }

  async listSessions(headers: Headers): Promise<SessionSummary[]> {
    const current = await this.getSession(headers);
    if (!current) return [];
    return [...this.sessions.values()]
      .filter((s) => s.userId === current.userId)
      .map((s) => ({ id: s.sessionId, createdAt: new Date(0), expiresAt: s.expiresAt, userAgent: null, current: s.sessionId === current.sessionId }));
  }

  async revokeSession(headers: Headers, sessionId: string): Promise<boolean> {
    const current = await this.getSession(headers);
    const target = this.sessions.get(sessionId);
    if (!current || !target || target.userId !== current.userId) return false;
    return this.sessions.delete(sessionId);
  }

  handleRequest(): Promise<Response> {
    return Promise.resolve(new Response('not found', { status: 404 }));
  }
}

export const fixedClock = (iso: string) => ({ now: () => new Date(iso) });
