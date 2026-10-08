/**
 * AuthPort: the ONLY authentication surface the rest of the platform may depend on.
 * Better Auth is an implementation detail behind it (see ./better-auth).
 */
export interface SessionInfo {
  sessionId: string;
  userId: string;
  email: string;
  name: string;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  expiresAt: Date;
}

/** Safe session view: never exposes the session token. */
export interface SessionSummary {
  id: string;
  createdAt: Date;
  expiresAt: Date;
  userAgent: string | null;
  current: boolean;
}

export interface AuthPort {
  getSession(headers: Headers): Promise<SessionInfo | null>;
  listSessions(headers: Headers): Promise<SessionSummary[]>;
  /** Revokes one of the caller's own sessions. Returns false when it does not exist / is not theirs. */
  revokeSession(headers: Headers, sessionId: string): Promise<boolean>;
  /** Handles the provider HTTP surface mounted under /api/auth/*. */
  handleRequest(request: Request): Promise<Response>;
}

export type SendEmail = (message: { to: string; subject: string; text: string }) => Promise<void>;
