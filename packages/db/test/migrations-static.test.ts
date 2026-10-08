import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MIGRATION_MANIFEST } from '../migrations/manifest.ts';
import { quoteIdent, quoteLiteral } from '../src/provision.ts';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

describe('migration files (static checks)', () => {
  it('manifest matches the migrations directory exactly', () => {
    expect([...MIGRATION_MANIFEST]).toEqual(files);
  });
  it('never grants BYPASSRLS or superuser, and never FORCEs/disables RLS unsafely', () => {
    for (const f of files) {
      const s = readFileSync(join(dir, f), 'utf8');
      expect(s).not.toMatch(/BYPASSRLS/i);
      expect(s).not.toMatch(/SUPERUSER/i);
      expect(s).not.toMatch(/DISABLE\s+ROW\s+LEVEL\s+SECURITY/i);
    }
  });
  it('enables RLS on every table that has a workspace_id column', () => {
    const s = readFileSync(join(dir, '0001_init.sql'), 'utf8');
    const tables = [...s.matchAll(/CREATE TABLE (\w+) \(([\s\S]*?)\n\);/g)];
    for (const [, name, body] of tables) {
      if (body && /\bworkspace_id\b/.test(body) && name !== 'audit_logs') {
        expect(s, `RLS missing for ${name}`).toMatch(new RegExp(`ALTER TABLE ${name}\\s+ENABLE ROW LEVEL SECURITY`));
      }
    }
    expect(s).toMatch(/ALTER TABLE audit_logs\s+ENABLE ROW LEVEL SECURITY/);
  });
});

describe('provision quoting helpers', () => {
  it('escapes literals and rejects bad identifiers', () => {
    expect(quoteLiteral("a'b")).toBe("'a''b'");
    expect(() => quoteLiteral('a\u0000')).toThrow();
    expect(quoteIdent('bnlinkvault_it')).toBe('"bnlinkvault_it"');
    expect(() => quoteIdent('x"; drop')).toThrow();
  });
});
