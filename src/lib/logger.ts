/**
 * 结构化 JSON 日志。
 * - 全量输出为单行 JSON，便于采集与检索
 * - 自动脱敏常见敏感字段（password / token / secret ...）
 * - 请求链路通过 requestId 串联
 */
import { config } from './config';
import { describeError } from './errors';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogMeta = Record<string, unknown>;

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SENSITIVE_KEY = /pass(word|wd)?|secret|token|authorization|cookie|credential|apikey|api_key/i;
const REDACTED = '[REDACTED]';

function resolveLevel(): LogLevel {
  const raw = config.logLevel.toLowerCase();
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') return raw;
  return config.isProduction ? 'info' : 'debug';
}

function sanitize(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Error) return describeError(value);
  if (typeof value !== 'object') return value;
  if (depth > 4) return '[depth-limit]';
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitize(item, depth + 1));

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    output[key] = SENSITIVE_KEY.test(key) ? REDACTED : sanitize(item, depth + 1);
  }
  return output;
}

function write(level: LogLevel, message: string, meta?: LogMeta): void {
  const payload = {
    ts: new Date().toISOString(),
    level,
    app: config.appName,
    msg: message,
    ...(meta ? (sanitize(meta) as LogMeta) : {}),
  };
  const line = JSON.stringify(payload);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export type Logger = {
  debug: (message: string, meta?: LogMeta) => void;
  info: (message: string, meta?: LogMeta) => void;
  warn: (message: string, meta?: LogMeta) => void;
  error: (message: string, meta?: LogMeta) => void;
  child: (base: LogMeta) => Logger;
};

export function createLogger(base: LogMeta = {}): Logger {
  const emit = (level: LogLevel, message: string, meta?: LogMeta): void => {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[resolveLevel()]) return;
    write(level, message, { ...base, ...(meta ?? {}) });
  };
  return {
    debug: (message, meta) => emit('debug', message, meta),
    info: (message, meta) => emit('info', message, meta),
    warn: (message, meta) => emit('warn', message, meta),
    error: (message, meta) => emit('error', message, meta),
    child: (extra) => createLogger({ ...base, ...extra }),
  };
}

export const logger = createLogger();
