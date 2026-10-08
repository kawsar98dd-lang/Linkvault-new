/**
 * Tracing port. Phase 2 ships the interface and a no-op tracer. The web app wires an
 * OpenTelemetry-backed implementation only when an exporter/Sentry tracing is configured;
 * `tracingStatus()` reports honestly which one is active.
 */
export interface Span {
  setAttribute(key: string, value: string | number | boolean): void;
  recordError(error: unknown): void;
}

export interface Tracer {
  readonly kind: 'noop' | 'otel';
  withSpan<T>(name: string, attributes: Readonly<Record<string, string | number | boolean>>, fn: (span: Span) => Promise<T>): Promise<T>;
}

const noopSpan: Span = { setAttribute: () => undefined, recordError: () => undefined };

export const noopTracer: Tracer = {
  kind: 'noop',
  withSpan: (_name, _attributes, fn) => fn(noopSpan),
};

export function tracingStatus(tracer: Tracer): 'active' | 'inactive' {
  return tracer.kind === 'noop' ? 'inactive' : 'active';
}

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/;

/** W3C traceparent -> trace id (used to correlate logs with traces). */
export function parseTraceparent(header: string | null | undefined): { traceId: string; spanId: string } | null {
  if (!header) return null;
  const m = TRACEPARENT.exec(header.trim());
  if (!m || m[1] === '0'.repeat(32) || m[2] === '0'.repeat(16)) return null;
  return { traceId: m[1] as string, spanId: m[2] as string };
}
