import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { MIGRATION_MANIFEST } from '../migrations/manifest.ts';
import { migrate } from '../src/migrate.ts';
import { checkDatabaseReady, createDatabase } from '../src/index.ts';
import { urlFor } from './helpers.ts';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

describe('migrations on a real database', () => {
  it('re-running is a no-op (idempotent replay)', async () => {
    const pool = new pg.Pool({ connectionString: urlFor('app_migrator'), max: 1 });
    try {
      const r = await migrate(pool, dir);
      expect(r.applied).toEqual([]);
      expect(r.skipped).toEqual([...MIGRATION_MANIFEST]);
    } finally { await pool.end(); }
  });
  it('detects a modified, already-applied migration (checksum drift)', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mig-'));
    cpSync(dir, tmp, { recursive: true });
    const f = join(tmp, '0001_init.sql');
    writeFileSync(f, `${readFileSync(f, 'utf8')}\n-- tampered\n`);
    const pool = new pg.Pool({ connectionString: urlFor('app_migrator'), max: 1 });
    try {
      await expect(migrate(pool, tmp)).rejects.toThrow(/checksum mismatch/);
    } finally { await pool.end(); }
  });
  it('readiness is true on the migrated DB for the runtime role', async () => {
    const pool = new pg.Pool({ connectionString: urlFor('app_rw'), max: 1 });
    try {
      const r = await checkDatabaseReady(createDatabase(pool));
      expect(r).toEqual({ ok: true, failures: [] });
    } finally { await pool.end(); }
  });
  it('readiness FAILS closed when the runtime role is privileged', async () => {
    const pool = new pg.Pool({ connectionString: urlFor('admin'), max: 1 });
    try {
      const r = await checkDatabaseReady(createDatabase(pool));
      expect(r.ok).toBe(false);
      expect(r.failures.join(' ')).toMatch(/bypass RLS/);
    } finally { await pool.end(); }
  });
});
