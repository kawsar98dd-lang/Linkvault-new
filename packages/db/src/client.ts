import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.ts';

export type Database = ReturnType<typeof createDatabase>;
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface PoolOptions {
  connectionString: string;
  max?: number;
  /** Called for idle-client errors; MUST NOT log connection strings. */
  onError?: (error: Error) => void;
}

export function createPool(options: PoolOptions): pg.Pool {
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    max: options.max ?? 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: 'bnlinkvault-web',
  });
  pool.on('error', (e) => {
    options.onError?.(e);
  });
  return pool;
}

export function createDatabase(pool: pg.Pool) {
  return drizzle(pool, { schema });
}
