import { AppError } from '@/lib/errors';
import { createRouteHandler, ok, readJsonBody } from '@/lib/http';
import { systemService } from '@/lib/services/systemService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 同源校验。
 *
 * 本接口会在用户机器上弹出系统文件管理器，属于「有副作用的本地操作」。
 * 浏览器里任何第三方网页都可能向 http://127.0.0.1:<port> 发起跨站请求
 * （localhost 不是 CSRF 保护），因此必须拒绝非同源调用。
 * 缺少 Origin 头（curl、桌面端壳、同源导航）时放行。
 */
function assertSameOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  if (!origin) return;

  const host = request.headers.get('host');
  if (!host) throw AppError.badRequest('缺少 Host 请求头');

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw AppError.badRequest(`Origin 请求头不合法: ${origin}`);
  }
  if (originHost !== host) {
    throw AppError.badRequest(`拒绝非同源调用（Origin: ${originHost}，Host: ${host}）`);
  }
}

/** 边界处校验请求体，不信任客户端数据 */
function parseBody(raw: unknown): { dryRun: boolean } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw AppError.validation('请求体必须是 JSON 对象');
  }
  const { dryRun } = raw as Record<string, unknown>;
  if (dryRun === undefined) return { dryRun: false };
  if (typeof dryRun !== 'boolean') {
    throw AppError.validation('字段 dryRun 必须是布尔值');
  }
  return { dryRun };
}

/**
 * POST /api/system/reveal-data-dir
 *
 * 在系统文件管理器中打开**后端正在使用的**数据目录，并返回该目录的绝对路径。
 * 请求体（可选）：`{ "dryRun": true }` 只查询路径、不打开。
 */
export const POST = createRouteHandler('system.reveal-data-dir', async (request, _context, log) => {
  assertSameOrigin(request);
  const { dryRun } = parseBody(await readJsonBody(request));

  const result = await systemService.revealDataDir({ dryRun });
  log.info('数据目录已解析', {
    dir: result.path,
    source: result.source,
    dryRun,
    entryCount: result.entryCount,
  });
  return ok(result);
});
