import { config } from '@/lib/config';
import { createRouteHandler, ok, readJsonBody } from '@/lib/http';
import { accountService } from '@/lib/services/accountService';
import { validateObject } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type CreateAccountBody = {
  label?: string;
  email: string;
  password: string;
  imapHost?: string;
  imapPort?: number;
  secure?: boolean;
  verify: boolean;
};

/** GET /api/accounts —— 账号列表（不含密码） */
export const GET = createRouteHandler('accounts.list', async () =>
  ok({
    accounts: await accountService.list(),
    defaults: config.mail.defaults,
  }),
);

/** POST /api/accounts —— 新增 2925 邮箱账号（默认先做真实连通性检测） */
export const POST = createRouteHandler('accounts.create', async (request) => {
  const body = await readJsonBody(request);
  const input = validateObject<CreateAccountBody>(body, {
    label: { type: 'string', max: 60, label: '备注名' },
    email: { type: 'email', required: true, max: 160, label: '邮箱地址' },
    password: { type: 'string', required: true, min: 1, max: 200, label: '邮箱密码' },
    imapHost: { type: 'string', max: 160, label: 'IMAP 服务器' },
    imapPort: { type: 'int', min: 1, max: 65_535, label: 'IMAP 端口' },
    secure: { type: 'boolean', label: '启用 SSL/TLS' },
    verify: { type: 'boolean', default: true, label: '是否校验连接' },
  });

  const account = await accountService.create(
    {
      label: input.label ?? '',
      email: input.email,
      password: input.password,
      imapHost: input.imapHost,
      imapPort: input.imapPort,
      secure: input.secure,
    },
    { verify: input.verify },
  );

  return ok({ account }, { status: 201 });
});
