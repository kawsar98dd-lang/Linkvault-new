import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { harness, type Harness } from './helpers.ts';

let h: Harness;
beforeAll(() => { h = harness(); });
afterAll(async () => { await h.close(); });

describe('database roles (real PostgreSQL)', () => {
  it('app_rw MUST NOT have BYPASSRLS, superuser or role/db creation', async () => {
    const { rows } = await h.admin.query(
      `select rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication, rolcanlogin
         from pg_roles where rolname in ('app_rw','app_migrator','audit_writer') order by rolname`,
    );
    expect(rows.map((r) => r.rolname)).toEqual(['app_migrator', 'app_rw', 'audit_writer']);
    for (const r of rows) {
      expect(r.rolsuper, `${r.rolname} superuser`).toBe(false);
      expect(r.rolbypassrls, `${r.rolname} bypassrls`).toBe(false);
      expect(r.rolcreaterole, `${r.rolname} createrole`).toBe(false);
      expect(r.rolcreatedb, `${r.rolname} createdb`).toBe(false);
      expect(r.rolreplication, `${r.rolname} replication`).toBe(false);
    }
    expect(rows.find((r) => r.rolname === 'audit_writer')?.rolcanlogin).toBe(false);
  });

  it('the live runtime session is not privileged', async () => {
    const { rows } = await h.appPool.query(
      `select current_user as u, (select rolbypassrls from pg_roles where rolname = current_user) as bypass,
              (select rolsuper from pg_roles where rolname = current_user) as su`,
    );
    expect(rows[0]).toEqual({ u: 'app_rw', bypass: false, su: false });
  });

  it('app_rw owns no tables and cannot create objects', async () => {
    const owned = await h.admin.query(`select tablename from pg_tables where schemaname = 'public' and tableowner = 'app_rw'`);
    expect(owned.rows).toEqual([]);
    const { rows } = await h.admin.query(
      `select has_schema_privilege('app_rw','public','CREATE') as c_public,
              has_schema_privilege('app_rw','app','CREATE') as c_app,
              has_database_privilege('app_rw', current_database(), 'CREATE') as c_db`,
    );
    expect(rows[0]).toEqual({ c_public: false, c_app: false, c_db: false });
  });

  it('every table with a workspace_id column has RLS enabled', async () => {
    const { rows } = await h.admin.query(
      `select c.relname, c.relrowsecurity
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
          and exists (select 1 from information_schema.columns col
                       where col.table_schema = 'public' and col.table_name = c.relname and col.column_name = 'workspace_id')`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(5);
    for (const r of rows) expect(r.relrowsecurity, `RLS on ${r.relname}`).toBe(true);
  });

  it('audit_logs privileges enforce append-only role separation', async () => {
    const { rows } = await h.admin.query(
      `select has_table_privilege('app_rw','audit_logs','INSERT') as rw_ins,
              has_table_privilege('app_rw','audit_logs','UPDATE') as rw_upd,
              has_table_privilege('app_rw','audit_logs','DELETE') as rw_del,
              has_table_privilege('app_rw','audit_logs','TRUNCATE') as rw_trunc,
              has_table_privilege('audit_writer','audit_logs','INSERT') as aw_ins,
              has_table_privilege('audit_writer','audit_logs','SELECT') as aw_sel,
              has_table_privilege('audit_writer','audit_logs','UPDATE') as aw_upd`,
    );
    expect(rows[0]).toEqual({ rw_ins: false, rw_upd: false, rw_del: false, rw_trunc: false, aw_ins: true, aw_sel: false, aw_upd: false });
  });
});
