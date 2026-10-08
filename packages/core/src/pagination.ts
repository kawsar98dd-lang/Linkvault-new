import { AppError } from './errors.ts';

/** Opaque keyset cursor: (timestamp, id) of the last item of the previous page. */
export interface KeysetCursor {
  t: string;
  id: string;
}

export function encodeCursor(c: KeysetCursor): string {
  return Buffer.from(JSON.stringify({ v: 1, t: c.t, id: c.id }), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string | undefined): KeysetCursor | null {
  if (raw === undefined) return null;
  const invalid = () => new AppError('validation_failed', { fieldErrors: [{ path: 'cursor', message: 'invalid cursor' }] });
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null) throw invalid();
    const o = parsed as Record<string, unknown>;
    if (o.v !== 1 || typeof o.t !== 'string' || typeof o.id !== 'string') throw invalid();
    if (Number.isNaN(Date.parse(o.t)) || o.id.length === 0 || o.id.length > 64) throw invalid();
    return { t: o.t, id: o.id };
  } catch (e) {
    throw e instanceof AppError ? e : invalid();
  }
}

export interface Page<T> {
  data: T[];
  next_cursor: string | null;
}

/** Given `limit + 1` rows fetched, trims to `limit` and derives the next cursor. */
export function toPage<T>(rows: T[], limit: number, keyOf: (row: T) => KeysetCursor): Page<T> {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data[data.length - 1];
  return { data, next_cursor: hasMore && last !== undefined ? encodeCursor(keyOf(last)) : null };
}
