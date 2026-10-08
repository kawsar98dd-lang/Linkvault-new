/** Ordered list of migrations the application expects. /readyz fails if the database lacks any. */
export const MIGRATION_MANIFEST: readonly string[] = ['0001_init.sql'];
