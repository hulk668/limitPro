/**
 * HTTP 层统一封装：
 *  - ok() / fail() 产出规范化的响应结构
 *  - createRouteHandler() 提供 requestId 注入、耗时统计、全局错误处理
 * 控制器只负责解析请求 -> 调用服务 -> 返回响应，错误统一由这里兜底。
 */
import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { AppError, describeError, isAppError, toAppError } from './errors';
import { createLogger, type Logger } from './logger';
import type { ApiFailure, ApiSuccess } from './types';

export const REQUEST_ID_HEADER = 'x-request-id';

export function ok<T>(data: T, options: { status?: number; requestId?: string } = {}): NextResponse<ApiSuccess<T>> {
  const requestId = options.requestId ?? randomUUID();
  const response = NextResponse.json<ApiSuccess<T>>(
    { ok: true, data, requestId },
    { status: options.status ?? 200 },
  );
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

export function fail(error: AppError, requestId: string): NextResponse<ApiFailure> {
  const response = NextResponse.json<ApiFailure>(
    {
      ok: false,
      error: {
        code: error.code,
        message: error.safeToExpose ? error.message : '服务器内部错误，请查看日志',
        ...(error.details === undefined ? {} : { details: error.details }),
      },
      requestId,
    },
    { status: error.status },
  );
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

/** 动态路由的路径参数类型（如 { id: string }）；静态路由使用默认的 Record<string, never> */
export type RouteParams = Record<string, string>;

/**
 * 包装路由处理器：注入 requestId / 子日志器，并把异常统一交给 fail()。
 * 控制器内部无需再写 try/catch。
 */
export function createRouteHandler<P extends RouteParams = Record<string, never>>(
  routeName: string,
  handler: (
    request: Request,
    context: { params: P },
    logger: Logger,
  ) => Promise<NextResponse> | NextResponse,
) {
  return async (request: Request, ctx?: { params?: Promise<P> }): Promise<NextResponse> => {
    const requestId = request.headers.get(REQUEST_ID_HEADER) ?? randomUUID();
    const log = createLogger({ requestId, route: routeName, method: request.method });
    const startedAt = Date.now();
    try {
      const params = ((ctx?.params ? await ctx.params : {}) ?? {}) as P;
      const response = await handler(request, { params }, log);
      response.headers.set(REQUEST_ID_HEADER, requestId);
      log.info('请求处理完成', { status: response.status, durationMs: Date.now() - startedAt });
      return response;
    } catch (error) {
      const appError = toAppError(error);
      if (appError.status >= 500) {
        log.error('请求处理失败', {
          code: appError.code,
          message: appError.message,
          durationMs: Date.now() - startedAt,
          error: describeError(isAppError(error) ? appError.cause ?? error : error),
        });
      } else {
        log.warn('请求被拒绝', {
          code: appError.code,
          message: appError.message,
          details: appError.details,
          durationMs: Date.now() - startedAt,
        });
      }
      return fail(appError, requestId);
    }
  };
}

/** 读取必填路径参数（缺失即 400） */
export function requireParam(params: RouteParams, key: string): string {
  const value = params[key];
  if (!value || !value.trim()) {
    throw AppError.validation(`缺少路径参数: ${key}`);
  }
  return value.trim();
}

/** 读取并解析 JSON 请求体（空体返回 {}） */
export async function readJsonBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw AppError.validation('请求体不是合法的 JSON');
  }
}
