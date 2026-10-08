import { NextResponse, type NextRequest } from 'next/server';
import { buildCsp, securityHeaders } from './lib/security-headers.ts';

/** Security headers + per-request CSP nonce (Report-Only in Phase 2; see docs/security/headers-csp.md). */
export function middleware(request: NextRequest): NextResponse {
  const nonce = btoa(crypto.randomUUID());
  const isProd = process.env.NODE_ENV === 'production';
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  // Next.js reads the nonce from the request CSP header to nonce its own inline scripts.
  const csp = buildCsp({ nonce, isDev: !isProd });
  requestHeaders.set('content-security-policy-report-only', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  for (const [k, v] of Object.entries(securityHeaders({ isProd }))) response.headers.set(k, v);
  response.headers.set('content-security-policy-report-only', csp);
  return response;
}

export const config = {
  matcher: [{ source: '/((?!_next/static|_next/image|favicon.ico).*)' }],
};
