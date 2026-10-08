import type pg from 'pg';

/** Safe SQL string literal (role passwords cannot be bind parameters in CREATE/ALTER ROLE). */
export function quoteLiteral(value: string): string {
  if (value.includes('\u0000')) throw new Error('NUL not allowed');
  return `'${value.replaceAll("'", "''")}'`;
}

/** Double-quoted identifier. */
export function quoteIdent(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error('invalid identifier');
  return `"${value}"`;
}

export interface ProvisionInput {
  database: string;
  appRwPassword: string;
  appMigratorPassword: string;
}

const NO_POWER = 'NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS';

/**
 * Creates/updates the three platform roles. Run ONCE per database by a privileged admin
 * (never by the application). Idempotent. Roles:
 *  - app_rw        runtime role. LOGIN. Subject to RLS. No DDL. No BYPASSRLS.
 *  - app_migrator  owns schema objects; used only by migrations/CI.
 *  - audit_writer  NOLOGIN; owns the audit write function.
 */
export async function provisionRoles(admin: pg.Client, input: ProvisionInput): Promise<void> {
  if (input.appRwPassword.length < 12 || input.appMigratorPassword.length < 12) {
    throw new Error('role passwords must be at least 12 characters');
  }
  const db = quoteIdent(input.database);
  const upsert = (role: string, attrs: string) => `
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
        CREATE ROLE ${role} ${attrs};
      ELSE
        ALTER ROLE ${role} ${attrs};
      END IF;
    END $$;`;

  await admin.query(upsert('audit_writer', `NOLOGIN ${NO_POWER}`));
  await admin.query(upsert('app_rw', `LOGIN PASSWORD ${quoteLiteral(input.appRwPassword)} ${NO_POWER}`));
  await admin.query(upsert('app_migrator', `LOGIN PASSWORD ${quoteLiteral(input.appMigratorPassword)} ${NO_POWER}`));

  await admin.query('GRANT audit_writer TO app_migrator');
  await admin.query(`GRANT CONNECT ON DATABASE ${db} TO app_rw, app_migrator`);
  await admin.query(`GRANT CREATE ON DATABASE ${db} TO app_migrator`);
  await admin.query('ALTER SCHEMA public OWNER TO app_migrator');
}
