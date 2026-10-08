export function buildCsp(opts: { nonce: string; isDev: boolean }): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'", `'nonce-${opts.nonce}'`, "'strict-dynamic'", ...(opts.isDev ? ["'unsafe-eval'"] : [])],
    'style-src': ["'self'", ...(opts.isDev ? ["'unsafe-inline'"] : [`'nonce-${opts.nonce}'`])],
    'img-src': ["'self'", 'data:'],
    'font-src': ["'self'"],
    'connect-src': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'none'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
    'report-uri': ['/api/csp-report'],
  };
  return Object.entries(directives).map(([k, v]) => `${k} ${v.join(' ')}`).join('; ');
}

export function securityHeaders(opts: { isProd: boolean }): Record<string, string> {
  const headers: Record<string, string> = {
    'referrer-policy': 'strict-origin-when-cross-origin',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
  };
  if (opts.isProd) headers['strict-transport-security'] = 'max-age=63072000; includeSubDomains; preload';
  return headers;
}
