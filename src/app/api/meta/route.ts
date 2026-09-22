import { config } from '@/lib/config';
import { createRouteHandler, ok } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/meta —— 把后端默认值/限制暴露给前端，避免前端硬编码 */
export const GET = createRouteHandler('meta', async () =>
  ok({
    app: { name: config.appName, nodeEnv: config.nodeEnv },
    mail: {
      provider: config.mail.provider,
      defaults: config.mail.defaults,
      fetchLimit: config.mail.fetchLimit,
      maxFetchLimit: config.mail.maxFetchLimit,
      defaultSinceMinutes: config.mail.defaultSinceMinutes,
      maxSinceMinutes: config.mail.maxSinceMinutes,
      /** 提示前端：2925 不支持 IMAP SEARCH，服务端已按序号拉取 */
      disableServerSearch: config.mail.disableServerSearch,
    },
    credential: {
      maxBatch: config.credential.maxBatch,
      usernameMinLength: config.credential.usernameMinLength,
      usernameMaxLength: config.credential.usernameMaxLength,
      passwordMinLength: config.credential.passwordMinLength,
      passwordMaxLength: config.credential.passwordMaxLength,
      defaults: config.credential.defaults,
    },
  }),
);
