import { checkDatabaseReady } from '@bnlinkvault/db';
import { container } from '@/server/container';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Readiness: configuration valid, database reachable, expected migrations applied and the runtime
 * role is not privileged. Any failure => 503. Details go to logs, never to the response.
 */
export async function GET(): Promise<Response> {
  const headers = { 'cache-control': 'no-store' };
  try {
    const c = container(); // throws on invalid configuration
    const db = await checkDatabaseReady(c.db);
    if (!db.ok) {
      c.logger.error('readiness failed', { failures: db.failures });
      return Response.json({ status: 'unavailable' }, { status: 503, headers });
    }
    return Response.json({ status: 'ready' }, { headers });
  } catch {
    return Response.json({ status: 'unavailable' }, { status: 503, headers });
  }
}
