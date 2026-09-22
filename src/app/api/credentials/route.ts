import { createRouteHandler, ok } from '@/lib/http';
import { credentialService } from '@/lib/services/credentialService';
import { searchParamsToObject, validateObject } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/credentials —— 生成记录（密码解密后返回，服务仅监听 127.0.0.1） */
export const GET = createRouteHandler('credentials.list', async (request) => {
  const query = validateObject<{ limit: number }>(
    searchParamsToObject(new URL(request.url).searchParams),
    { limit: { type: 'int', min: 1, max: 200, default: 50, label: '返回条数' } },
    '查询参数',
  );

  const credentials = await credentialService.list(query.limit);
  return ok({ credentials });
});

/** DELETE /api/credentials —— 清空生成记录 */
export const DELETE = createRouteHandler('credentials.clear', async () => {
  const removed = await credentialService.clear();
  return ok({ removed });
});
