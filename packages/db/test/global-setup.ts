import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { migrate } from '../src/migrate.ts';
import { provisionRoles } from '../src/provision.ts';
import { IT_DB, IT_PASSWORDS, adminUrl, urlFor } from './helpers.ts';

/** Fresh database per run: proves migrations build the schema from an EMPTY database. */
export default async function setup(): Promise<() => Promise<void>> {
  adminUrl();
  const maintenance = new pg.Client({ connectionString: urlFor('admin', 'postgres') });
  await maintenance.connect();
  await maintenance.query(`DROP DATABASE IF EXISTS ${IT_DB} WITH (FORCE)`);
  await maintenance.query(`CREATE DATABASE ${IT_DB}`);
  await maintenance.end();

  const admin = new pg.Client({ connectionString: urlFor('admin') });
  await admin.connect();
  await provisionRoles(admin, {
    database: IT_DB,
    appRwPassword: IT_PASSWORDS.app_rw,
    appMigratorPassword: IT_PASSWORDS.app_migrator,
  });
  await admin.end();

  const pool = new pg.Pool({ connectionString: urlFor('app_migrator'), max: 1 });
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
  await migrate(pool, dir);
  await pool.end();

  return async () => {
    const m = new pg.Client({ connectionString: urlFor('admin', 'postgres') });
    await m.connect();
    await m.query(`DROP DATABASE IF EXISTS ${IT_DB} WITH (FORCE)`);
    await m.end();
  };
}
