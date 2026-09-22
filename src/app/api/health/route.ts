import { config } from '@/lib/config';
import { createRouteHandler, ok } from '@/lib/http';
import { accountRepo } from '@/lib/repositories/accountRepo';
import { codeRepo } from '@/lib/repositories/codeRepo';
import { credentialRepo } from '@/lib/repositories/credentialRepo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/health —— Electron 主进程据此判断后端是否就绪 */
export const GET = createRouteHandler('health', async () => {
  const [accounts, codes, credentials] = await Promise.all([
    accountRepo.count(),
    codeRepo.count(),
    credentialRepo.count(),
  ]);

  return ok({
    status: 'ok',
    app: config.appName,
    version: process.env.npm_package_version ?? '0.1.0',
    nodeEnv: config.nodeEnv,
    uptimeSeconds: Math.round(process.uptime()),
    dataDir: config.dataDir,
    storage: { accounts, codes, credentials },
  });
});
