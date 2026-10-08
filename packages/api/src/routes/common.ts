import { ProblemSchema } from '@bnlinkvault/contracts';
import type { ZodTypeAny } from 'zod';

const problem = { content: { 'application/problem+json': { schema: ProblemSchema } }, description: 'Problem (RFC 9457)' };

/** Standard error responses documented on every protected route. */
export const errorResponses = { 400: problem, 401: problem, 403: problem, 404: problem, 409: problem, 422: problem, 429: problem } as const;

export const jsonBody = <T extends ZodTypeAny>(schema: T) => ({ content: { 'application/json': { schema } }, required: true as const });
export const jsonOk = <T extends ZodTypeAny>(schema: T, description: string) => ({ content: { 'application/json': { schema } }, description });
export const noContent = { description: 'No content' } as const;

