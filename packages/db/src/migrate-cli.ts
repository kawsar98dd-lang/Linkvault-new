import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { migrate } from './migrate.ts';

const url = process.env.MIGRATOR_DATABASE_URL;
if (!url) {
  process.stderr.write('MIGRATOR_DATABASE_URL is required\n');
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: url, max: 1 });
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
try {
  const r = await migrate(pool, dir);
  process.stdout.write(`migrations applied: [${r.applied.join(', ')}] skipped: [${r.skipped.join(', ')}]\n`);
} catch (e) {
  process.stderr.write(`${e instanceof Error ? e.message : 'migration failed'}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
