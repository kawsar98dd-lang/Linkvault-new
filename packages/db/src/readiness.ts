import { sql } from 'drizzle-orm';
import { MIGRATION_MANIFEST } from '../migrations/manifest.ts';
import type { Database } from './client.ts';

export interface DbReadiness {
  ok: boolean;
  /** Internal diagnostics for logs only; never return these to unauthenticated callers. */
  failures: string[];
}

/** Fail-closed readiness: connectivity, expected migrations, and a safe runtime role. */
export async function checkDatabaseReady(db: Database): Promise<DbReadiness> {
  const failures: string[] = [];
  try {
    const role = await db.execute<{ rolsuper: boolean; rolbypassrls: boolean }>(
      sql`select rolsuper, rolbypassrls from pg_roles where rolname = current_user`,
    );
    const row = role.rows[0];
    if (!row) failures.push('runtime role not found');
    else if (row.rolsuper || row.rolbypassrls) failures.push('runtime role can bypass RLS (superuser or BYPASSRLS)');

    const applied = await db.execute<{ name: string }>(sql`select name from schema_migrations`);
    const have = new Set(applied.rows.map((r) => r.name));
    for (const m of MIGRATION_MANIFEST) if (!have.has(m)) failures.push(`missing migration ${m}`);
  } catch {
    failures.push('database unreachable or schema not initialised');
  }
  return { ok: failures.length === 0, failures };
}
