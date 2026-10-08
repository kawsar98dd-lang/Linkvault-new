import type { ErrorCode } from '@bnlinkvault/contracts';

export const ERROR_STATUS: Readonly<Record<ErrorCode, number>> = {
  validation_failed: 400,
  unauthenticated: 401,
  email_not_verified: 403,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  idempotency_key_reuse: 422,
  idempotency_in_progress: 409,
  rate_limited: 429,
  csrf_failed: 403,
  captcha_failed: 403,
  internal_error: 500,
};

export interface FieldError {
  path: string;
  message: string;
}

/** Typed, client-safe error. `message` is for logs only and is never sent to clients. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fieldErrors: FieldError[] | undefined;
  readonly retryAfterSec: number | undefined;

  constructor(code: ErrorCode, options: { message?: string; fieldErrors?: FieldError[]; retryAfterSec?: number; cause?: unknown } = {}) {
    super(options.message ?? code, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.fieldErrors = options.fieldErrors;
    this.retryAfterSec = options.retryAfterSec;
  }
}

export const notFound = (message?: string): AppError => new AppError('not_found', message === undefined ? {} : { message });
export const forbidden = (message?: string): AppError => new AppError('forbidden', message === undefined ? {} : { message });
export const conflict = (message?: string): AppError => new AppError('conflict', message === undefined ? {} : { message });
export const unauthenticated = (): AppError => new AppError('unauthenticated');

/** Extracts a PostgreSQL error code regardless of driver wrapping. */
export function pgErrorCode(error: unknown): string | undefined {
  let e: unknown = error;
  for (let i = 0; i < 3 && typeof e === 'object' && e !== null; i++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

export function pgErrorMessage(error: unknown): string {
  let e: unknown = error;
  for (let i = 0; i < 3 && typeof e === 'object' && e !== null; i++) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === 'string' && m.length > 0 && (e as { code?: unknown }).code !== undefined) return m;
    e = (e as { cause?: unknown }).cause;
  }
  return error instanceof Error ? error.message : '';
}
