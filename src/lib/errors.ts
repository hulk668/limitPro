/**
 * 类型化错误体系 —— 业务层只抛 AppError，
 * 由全局错误处理器统一转换成规范化的 JSON 结构，绝不向客户端泄漏堆栈。
 */

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'MAIL_AUTH_ERROR'
  | 'MAIL_CONNECT_ERROR'
  | 'MAIL_FETCH_ERROR'
  | 'CRYPTO_ERROR'
  | 'STORAGE_ERROR'
  | 'INTERNAL_ERROR';

const DEFAULT_STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  MAIL_AUTH_ERROR: 401,
  MAIL_CONNECT_ERROR: 502,
  MAIL_FETCH_ERROR: 502,
  CRYPTO_ERROR: 500,
  STORAGE_ERROR: 500,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  /** 是否可以把 message 原样返回给客户端 */
  readonly safeToExpose: boolean;

  constructor(
    code: ErrorCode,
    message: string,
    options: { status?: number; details?: unknown; cause?: unknown; safeToExpose?: boolean } = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = options.status ?? DEFAULT_STATUS[code] ?? 500;
    this.details = options.details;
    this.safeToExpose = options.safeToExpose ?? code !== 'INTERNAL_ERROR';
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }

  static validation(message: string, details?: unknown): AppError {
    return new AppError('VALIDATION_ERROR', message, { details });
  }

  static badRequest(message: string, details?: unknown): AppError {
    return new AppError('BAD_REQUEST', message, { details });
  }

  static notFound(message: string, details?: unknown): AppError {
    return new AppError('NOT_FOUND', message, { details });
  }

  static conflict(message: string, details?: unknown): AppError {
    return new AppError('CONFLICT', message, { details });
  }

  static mailAuth(message: string, details?: unknown): AppError {
    return new AppError('MAIL_AUTH_ERROR', message, { details });
  }

  static mailConnect(message: string, details?: unknown): AppError {
    return new AppError('MAIL_CONNECT_ERROR', message, { details });
  }

  static mailFetch(message: string, details?: unknown): AppError {
    return new AppError('MAIL_FETCH_ERROR', message, { details });
  }

  static crypto(message: string, details?: unknown): AppError {
    return new AppError('CRYPTO_ERROR', message, { details });
  }

  static storage(message: string, details?: unknown): AppError {
    return new AppError('STORAGE_ERROR', message, { details });
  }

  static internal(message: string, details?: unknown): AppError {
    return new AppError('INTERNAL_ERROR', message, { details });
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

export function toAppError(value: unknown): AppError {
  if (isAppError(value)) return value;
  if (value instanceof Error) {
    return new AppError('INTERNAL_ERROR', value.message || '服务器内部错误', { cause: value });
  }
  return new AppError('INTERNAL_ERROR', '服务器内部错误');
}

/** 供日志使用：把任意异常转成可序列化的结构（含堆栈，仅落日志） */
export function describeError(value: unknown): Record<string, unknown> {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      ...(isAppError(value) ? { code: value.code, status: value.status } : {}),
    };
  }
  return { value: typeof value === 'string' ? value : JSON.stringify(value) };
}
