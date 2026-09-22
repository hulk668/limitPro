import { createRouteHandler, ok, requireParam } from '@/lib/http';
import { credentialService } from '@/lib/services/credentialService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** DELETE /api/credentials/:id —— 删除单条生成记录 */
export const DELETE = createRouteHandler<{ id: string }>('credentials.remove', async (_request, { params }) => {
  const id = requireParam(params, 'id');
  await credentialService.remove(id);
  return ok({ id });
});
