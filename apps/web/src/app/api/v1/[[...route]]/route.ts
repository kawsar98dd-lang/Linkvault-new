import { handle } from 'hono/vercel';
import { container } from '@/server/container';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handler = (request: Request): Response | Promise<Response> => handle(container().api.app)(request);

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const DELETE = handler;
