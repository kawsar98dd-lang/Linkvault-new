import { createLogger } from '@bnlinkvault/core';

export const runtime = 'nodejs';
const log = createLogger({ level: 'warn', base: { service: 'web', component: 'csp-report' } });

/** Receives CSP violation reports (Report-Only phase). Bounded, never echoes the payload. */
export async function POST(request: Request): Promise<Response> {
  const text = await request.text();
  if (text.length > 16_384) return new Response(null, { status: 413 });
  try {
    const parsed: unknown = JSON.parse(text);
    const r = ((parsed as Record<string, unknown>)['csp-report'] ?? parsed) as Record<string, unknown>;
    log.warn('csp violation', {
      directive: String(r['effective-directive'] ?? r.effectiveDirective ?? ''),
      blocked: String(r['blocked-uri'] ?? r.blockedURL ?? '').slice(0, 200),
      document: String(r['document-uri'] ?? r.documentURL ?? '').slice(0, 200),
    });
  } catch {
    // malformed reports are ignored
  }
  return new Response(null, { status: 204 });
}
