export type CaptchaMode = 'off' | 'on' | 'risk';
export type RiskLevel = 'low' | 'elevated';

export interface CaptchaVerifier {
  verify(token: string | null, context: { ip?: string; action: string }): Promise<boolean>;
}

/** Whether a challenge must be solved for this request. */
export function captchaRequired(mode: CaptchaMode, risk: RiskLevel): boolean {
  if (mode === 'on') return true;
  if (mode === 'risk') return risk === 'elevated';
  return false;
}

export class DisabledCaptchaVerifier implements CaptchaVerifier {
  verify(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Cloudflare Turnstile server-side verification. Fails CLOSED on network errors/timeouts. */
export class TurnstileVerifier implements CaptchaVerifier {
  private readonly secret: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(secret: string, fetchFn: typeof fetch = fetch, timeoutMs: number = 4000) {
    this.secret = secret;
    this.fetchFn = fetchFn;
    this.timeoutMs = timeoutMs;
  }

  async verify(token: string | null, context: { ip?: string; action: string }): Promise<boolean> {
    if (!token || token.length > 2048) return false;
    const body = new URLSearchParams({ secret: this.secret, response: token });
    if (context.ip && context.ip !== 'unknown') body.set('remoteip', context.ip);
    try {
      const res = await this.fetchFn(SITEVERIFY, { method: 'POST', body, signal: AbortSignal.timeout(this.timeoutMs) });
      if (!res.ok) return false;
      const json = (await res.json()) as { success?: unknown; action?: unknown };
      if (json.success !== true) return false;
      return json.action === undefined || json.action === '' || json.action === context.action;
    } catch {
      return false;
    }
  }
}
