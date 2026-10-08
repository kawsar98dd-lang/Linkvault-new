import pg from 'pg';
import { provisionRoles } from './provision.ts';

const adminUrl = process.env.ADMIN_DATABASE_URL;
const rw = process.env.APP_RW_PASSWORD;
const mig = process.env.APP_MIGRATOR_PASSWORD;
if (!adminUrl || !rw || !mig) {
  process.stderr.write('ADMIN_DATABASE_URL, APP_RW_PASSWORD and APP_MIGRATOR_PASSWORD are required\n');
  process.exit(1);
}
const database = decodeURIComponent(new URL(adminUrl).pathname.replace(/^\//, ''));
const client = new pg.Client({ connectionString: adminUrl });
try {
  await client.connect();
  await provisionRoles(client, { database, appRwPassword: rw, appMigratorPassword: mig });
  process.stdout.write('roles provisioned: app_rw, app_migrator, audit_writer\n');
} catch (e) {
  process.stderr.write(`provisioning failed: ${e instanceof Error ? e.message : 'unknown'}\n`);
  process.exitCode = 1;
} finally {
  await client.end();
}
