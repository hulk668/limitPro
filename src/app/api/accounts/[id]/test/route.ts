import { createRouteHandler, ok, requireParam } from '@/lib/http';
import { accountService } from '@/lib/services/accountService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/accounts/:id/test —— 手动触发 IMAP 连通性检测 */
export const POST = createRouteHandler<{ id: string }>('accounts.test', async (_request, { params }) => {
  const id = requireParam(params, 'id');
  const result = await accountService.test(id);
  return ok(result);
});
