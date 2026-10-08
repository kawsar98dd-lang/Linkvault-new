import { redact } from './redact.ts';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Readonly<Record<LogLevel, number>> = { debug: 10, info: 20, warn: 30, error: 40 };

export type LogFields = Readonly<Record<string, unknown>>;
export type LogSink = (line: string) => void;

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

export interface LoggerOptions {
  level: LogLevel;
  sink?: LogSink;
  base?: LogFields;
  now?: () => Date;
}

const stdoutSink: LogSink = (line) => {
  process.stdout.write(`${line}\n`);
};

/** Structured JSON logger. Every field passes through redact(). */
export function createLogger(options: LoggerOptions): Logger {
  const sink = options.sink ?? stdoutSink;
  const now = options.now ?? (() => new Date());
  const base = options.base ?? {};

  const build = (extra: LogFields): Logger => {
    const merged = { ...base, ...extra };
    const emit = (level: LogLevel, msg: string, fields?: LogFields): void => {
      if (ORDER[level] < ORDER[options.level]) return;
      const record = redact({ ...merged, ...fields }) as Record<string, unknown>;
      sink(JSON.stringify({ ts: now().toISOString(), level, msg, ...record }));
    };
    return {
      debug: (m, f) => emit('debug', m, f),
      info: (m, f) => emit('info', m, f),
      warn: (m, f) => emit('warn', m, f),
      error: (m, f) => emit('error', m, f),
      child: (f) => createLogger({ ...options, base: { ...merged, ...f } }),
    };
  };
  return build({});
}
