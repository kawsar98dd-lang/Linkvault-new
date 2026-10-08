import { describe, expect, it } from 'vitest';
import { buildCsp, securityHeaders } from '../src/lib/security-headers.ts';

describe('security headers', () => {
  it('builds a nonce-based CSP without unsafe directives in production', () => {
    const csp = buildCsp({ nonce: 'abc', isDev: false });
    expect(csp).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(csp).not.toMatch(/unsafe-eval|unsafe-inline/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain('report-uri /api/csp-report');
  });
  it('only relaxes the CSP in development', () => {
    expect(buildCsp({ nonce: 'abc', isDev: true })).toContain("'unsafe-eval'");
  });
  it('sends HSTS only in production', () => {
    expect(securityHeaders({ isProd: true })['strict-transport-security']).toMatch(/max-age=\d+/);
    expect(securityHeaders({ isProd: false })['strict-transport-security']).toBeUndefined();
    const h = securityHeaders({ isProd: true });
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['referrer-policy']).toBeTruthy();
    expect(h['permissions-policy']).toContain('camera=()');
  });
});
