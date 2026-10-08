import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { createDatabase, createPool, withTenant, withUser, type Database } from '../src/index.ts';
import { schema } from '../src/index.ts';

export const IT_DB = 'bnlinkvault_it';
// Test-only throwaway credentials for a database that is dropped and recreated on every run.
export const IT_PASSWORDS = { app_rw: 'it-app-rw-throwaway-1', app_migrator: 'it-migrator-throwaway-1' } as const;

export function adminUrl(): string {
  const u = process.env.TEST_ADMIN_DATABASE_URL;
  if (!u) throw new Error('TEST_ADMIN_DATABASE_URL is required: integration tests never skip');
  return u;
}

export function urlFor(role: 'admin' | 'app_rw' | 'app_migrator', database: string = IT_DB): string {
  const u = new URL(adminUrl());
  u.pathname = `/${database}`;
  if (role !== 'admin') {
    u.username = role;
    u.password = IT_PASSWORDS[role];
  }
  return u.toString();
}

export const newId = (prefix: string): string => `${prefix}_${randomBytes(8).toString('hex')}`;
export const publicId = (): string => `ws_${randomBytes(10).toString('hex')}`;

export interface Harness {
  admin: pg.Pool; // superuser: fixture setup + assertions about catalogs only
  appPool: pg.Pool;
  db: Database;
  close(): Promise<void>;
}

export function harness(): Harness {
  const admin = new pg.Pool({ connectionString: urlFor('admin'), max: 2 });
  const appPool = createPool({ connectionString: urlFor('app_rw'), max: 4 });
  const db = createDatabase(appPool);
  return { admin, appPool, db, close: async () => { await appPool.end(); await admin.end(); } };
}

export async function createUser(admin: pg.Pool, label: string): Promise<{ id: string; email: string }> {
  const id = newId('usr');
  const email = `${label}-${randomBytes(4).toString('hex')}@example.test`;
  await admin.query('insert into users (id, name, email, email_verified) values ($1, $2, $3, true)', [id, label, email]);
  return { id, email };
}

/** Creates a workspace + owner membership through the real RLS path (as app_rw). */
export async function createWorkspace(db: Database, ownerId: string, slug: string): Promise<{ id: string; publicId: string }> {
  const id = crypto.randomUUID();
  const pid = publicId();
  await withTenant(db, { userId: ownerId, workspaceId: id }, async (tx) => {
    await tx.insert(schema.workspaces).values({ id, publicId: pid, name: slug, slug, ownerUserId: ownerId });
    await tx.insert(schema.memberships).values({ workspaceId: id, userId: ownerId, role: 'owner' });
  });
  return { id, publicId: pid };
}

export { withTenant, withUser, schema };
