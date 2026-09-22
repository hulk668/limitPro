import { createRouteHandler, ok } from '@/lib/http';
import { mailService } from '@/lib/services/mailService';
import { searchParamsToObject, validateObject } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ListCodesQuery = {
  limit: number;
  accountId?: string;
};

/** GET /api/codes —— 验证码提取历史 */
export const GET = createRouteHandler('codes.list', async (request) => {
  const query = validateObject<ListCodesQuery>(
    searchParamsToObject(new URL(request.url).searchParams),
    {
      limit: { type: 'int', min: 1, max: 200, default: 50, label: '返回条数' },
      accountId: { type: 'string', max: 64, label: '邮箱账号' },
    },
    '查询参数',
  );

  const codes = await mailService.listCodes({ limit: query.limit, accountId: query.accountId });
  return ok({ codes });
});

/** DELETE /api/codes?accountId=xxx —— 清空验证码历史（可按账号） */
export const DELETE = createRouteHandler('codes.clear', async (request) => {
  const query = validateObject<{ accountId?: string }>(
    searchParamsToObject(new URL(request.url).searchParams),
    { accountId: { type: 'string', max: 64, label: '邮箱账号' } },
    '查询参数',
  );

  const removed = await mailService.clearCodes(query.accountId);
  return ok({ removed });
});
