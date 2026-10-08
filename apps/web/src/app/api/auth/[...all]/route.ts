import { guardAuthRequest } from '@bnlinkvault/api';
import { container } from '@/server/container';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Better Auth HTTP surface, always behind our rate-limit / Turnstile guard. */
async function handle(request: Request): Promise<Response> {
  const c = container();
  const requestId = crypto.randomUUID();
  const blocked = await guardAuthRequest(
    { rateLimiter: c.rateLimiter, captcha: c.captcha, captchaMode: c.captchaMode, logger: c.logger },
    request,
    requestId,
  );
  if (blocked) return blocked;
  const response = await c.auth.handleRequest(request);
  response.headers.set('cache-control', 'no-store');
  return response;
}

export const GET = handle;
export const POST = handle;
