import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type pg from 'pg';

export interface MigrationFile {
  name: string;
  sql: string;
  checksum: string;
}

const NAME_RE = /^\d{4}_[a-z0-9_]+\.sql$/;
const LOCK_KEY = 727_274;

export function loadMigrations(dir: string): MigrationFile[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => {
      if (!NAME_RE.test(name)) throw new Error(`Invalid migration file name: ${name}`);
      const sqlText = readFileSync(join(dir, name), 'utf8');
      return { name, sql: sqlText, checksum: createHash('sha256').update(sqlText).digest('hex') };
    });
}

export interface MigrateResult {
  applied: string[];
  skipped: string[];
}

/**
 * Applies migrations in order, each in its own transaction, under an advisory lock.
 * Refuses to continue if an already-applied migration file was modified (checksum drift).
 * Must run with the app_migrator role.
 */
export async function migrate(pool: pg.Pool, dir: string): Promise<MigrateResult> {
  const files = loadMigrations(dir);
  const client = await pool.connect();
  const result: MigrateResult = { applied: [], skipped: [] };
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`,
    );
    const { rows } = await client.query<{ name: string; checksum: string }>('SELECT name, checksum FROM schema_migrations');
    const done = new Map(rows.map((r) => [r.name, r.checksum]));

    for (const f of files) {
      const prior = done.get(f.name);
      if (prior !== undefined) {
        if (prior !== f.checksum) throw new Error(`Migration ${f.name} was modified after being applied (checksum mismatch)`);
        result.skipped.push(f.name);
        continue;
      }
      try {
        await client.query('BEGIN');
        await client.query(f.sql);
        await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [f.name, f.checksum]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${f.name} failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      }
      result.applied.push(f.name);
    }
    return result;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
    client.release();
  }
}
