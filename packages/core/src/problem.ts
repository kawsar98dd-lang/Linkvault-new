import type { Problem } from '@bnlinkvault/contracts';
import { t, type Locale } from '@bnlinkvault/i18n';
import { ZodError } from 'zod';
import { AppError, type FieldError } from './errors.ts';

export interface ProblemResult {
  status: number;
  body: Problem;
  headers: Record<string, string>;
}

const MAX_FIELD_ERRORS = 20;

function fromZod(error: ZodError): FieldError[] {
  return error.issues.slice(0, MAX_FIELD_ERRORS).map((i) => ({ path: i.path.join('.'), message: i.message.slice(0, 200) }));
}

/**
 * Converts any thrown value into an RFC 9457 problem document.
 * Unknown errors NEVER leak messages, stacks, SQL or driver details: they become `internal_error`.
 */
export function toProblem(error: unknown, ctx: { requestId: string; instance?: string; locale?: Locale }): ProblemResult {
  const locale = ctx.locale ?? 'en';
  let app: AppError;
  if (error instanceof AppError) app = error;
  else if (error instanceof ZodError) app = new AppError('validation_failed', { fieldErrors: fromZod(error) });
  else app = new AppError('internal_error');

  const body: Problem = {
    type: `urn:bnlinkvault:problem:${app.code}`,
    title: t(locale, `error.${app.code}`),
    status: app.status,
    code: app.code,
    request_id: ctx.requestId,
  };
  if (ctx.instance !== undefined) body.instance = ctx.instance;
  if (app.fieldErrors && app.fieldErrors.length > 0) body.errors = app.fieldErrors;

  const headers: Record<string, string> = { 'content-type': 'application/problem+json; charset=utf-8', 'cache-control': 'no-store' };
  if (app.retryAfterSec !== undefined) headers['retry-after'] = String(Math.max(1, Math.ceil(app.retryAfterSec)));
  return { status: app.status, body, headers };
}
