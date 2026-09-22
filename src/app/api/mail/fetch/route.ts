import { config } from '@/lib/config';
import { createRouteHandler, ok, readJsonBody } from '@/lib/http';
import { mailService } from '@/lib/services/mailService';
import { validateObject } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type FetchMailBody = {
  accountId: string;
  limit: number;
  sinceMinutes: number;
};

/**
 * POST /api/mail/fetch
 * 拉取指定邮箱最近邮件并精准提取验证码。
 * 前端以轮询方式调用本端点即可实现"等待验证码到达"的效果。
 */
export const POST = createRouteHandler('mail.fetch', async (request) => {
  const body = await readJsonBody(request);
  const input = validateObject<FetchMailBody>(body, {
    accountId: { type: 'string', required: true, max: 64, label: '邮箱账号' },
    limit: { type: 'int', min: 1, max: config.mail.maxFetchLimit, default: config.mail.fetchLimit, label: '拉取邮件数' },
    sinceMinutes: {
      type: 'int',
      min: 1,
      max: config.mail.maxSinceMinutes,
      default: config.mail.defaultSinceMinutes,
      label: '时间窗口(分钟)',
    },
  });

  const result = await mailService.fetchCodes({
    accountId: input.accountId,
    limit: input.limit,
    sinceMinutes: input.sinceMinutes,
  });

  return ok(result);
});
