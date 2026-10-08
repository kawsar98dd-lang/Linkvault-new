import 'server-only';
import { loadServerEnv, type ServerEnv } from '@bnlinkvault/config';

let cached: ServerEnv | undefined;

/** Validated once per process. Throws (fail-fast) on invalid/missing configuration. */
export function serverEnv(): ServerEnv {
  cached ??= loadServerEnv();
  return cached;
}
