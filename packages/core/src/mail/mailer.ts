import { createLogger } from '../observability/logger.ts';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}
export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/** Records messages in memory (tests). */
export class MemoryMailer implements Mailer {
  readonly sent: MailMessage[] = [];
  send(message: MailMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }
}

/**
 * Development-only mailer: prints the message (including links) to stdout so flows can be tried
 * locally. Construction THROWS in production.
 */
export class ConsoleMailer implements Mailer {
  private readonly out = createLogger({ level: 'info', base: { component: 'console-mailer' } });
  constructor(nodeEnv: string) {
    if (nodeEnv === 'production') throw new Error('ConsoleMailer must not be used in production');
  }
  send(message: MailMessage): Promise<void> {
    // Deliberately logs the raw text (dev only): redact() would hide tokens inside links otherwise.
    process.stdout.write(`${JSON.stringify({ level: 'info', msg: 'dev-mail', to: message.to, subject: message.subject, text: message.text })}\n`);
    this.out.debug('dev mail printed');
    return Promise.resolve();
  }
}

/** Postmark transactional email (HTTPS API). Fails loudly; callers decide whether to retry. */
export class PostmarkMailer implements Mailer {
  private readonly serverToken: string;
  private readonly from: string;
  private readonly fetchFn: typeof fetch;

  constructor(serverToken: string, from: string, fetchFn: typeof fetch = fetch) {
    this.serverToken = serverToken;
    this.from = from;
    this.fetchFn = fetchFn;
  }

  async send(message: MailMessage): Promise<void> {
    const res = await this.fetchFn('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', 'x-postmark-server-token': this.serverToken },
      body: JSON.stringify({ From: this.from, To: message.to, Subject: message.subject, TextBody: message.text, MessageStream: 'outbound' }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`email provider responded ${res.status}`);
  }
}
