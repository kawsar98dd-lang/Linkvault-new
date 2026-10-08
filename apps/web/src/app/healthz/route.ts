export const dynamic = 'force-dynamic';

/** Liveness only: the process is up. Intentionally has NO dependency checks. */
export function GET(): Response {
  return Response.json({ status: 'ok' }, { headers: { 'cache-control': 'no-store' } });
}
