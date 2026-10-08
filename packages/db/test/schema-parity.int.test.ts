import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { harness, schema, type Harness } from './helpers.ts';

let h: Harness;
beforeAll(() => { h = harness(); });
afterAll(async () => { await h.close(); });

describe('Drizzle schema <-> migrated database parity', () => {
  it('every Drizzle table/column exists in PostgreSQL with matching nullability', async () => {
    const tables = Object.values(schema).filter((v) => typeof v === 'object' && v !== null && Symbol.for('drizzle:IsDrizzleTable') in v);
    expect(tables.length).toBeGreaterThanOrEqual(10);
    for (const t of tables) {
      const cfg = getTableConfig(t as Parameters<typeof getTableConfig>[0]);
      const { rows } = await h.admin.query(
        `select column_name, is_nullable from information_schema.columns where table_schema='public' and table_name=$1`, [cfg.name]);
      expect(rows.length, `table ${cfg.name} missing`).toBeGreaterThan(0);
      const db = new Map(rows.map((r) => [r.column_name as string, r.is_nullable === 'YES']));
      for (const c of cfg.columns) {
        expect(db.has(c.name), `${cfg.name}.${c.name} missing in DB`).toBe(true);
        expect(db.get(c.name), `${cfg.name}.${c.name} nullability`).toBe(!c.notNull);
      }
      expect([...db.keys()].sort(), `${cfg.name} column set`).toEqual(cfg.columns.map((c) => c.name).sort());
    }
  });
});
