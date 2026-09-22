import { createRouteHandler, ok, readJsonBody, requireParam } from '@/lib/http';
import { accountService } from '@/lib/services/accountService';
import { validateObject } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type UpdateAccountBody = {
  label?: string;
  email?: string;
  password?: string;
  imapHost?: string;
  imapPort?: number;
  secure?: boolean;
  verify: boolean;
};

/** PATCH /api/accounts/:id —— 修改账号信息（改密码会重新校验连接） */
export const PATCH = createRouteHandler<{ id: string }>('accounts.update', async (request, { params }) => {
  const id = requireParam(params, 'id');
  const body = await readJsonBody(request);
  const input = validateObject<UpdateAccountBody>(body, {
    label: { type: 'string', max: 60, label: '备注名' },
    email: { type: 'email', max: 160, label: '邮箱地址' },
    password: { type: 'string', min: 1, max: 200, label: '邮箱密码' },
    imapHost: { type: 'string', max: 160, label: 'IMAP 服务器' },
    imapPort: { type: 'int', min: 1, max: 65_535, label: 'IMAP 端口' },
    secure: { type: 'boolean', label: '启用 SSL/TLS' },
    verify: { type: 'boolean', default: true, label: '是否校验连接' },
  });

  const account = await accountService.update(
    id,
    {
      label: input.label,
      email: input.email,
      password: input.password,
      imapHost: input.imapHost,
      imapPort: input.imapPort,
      secure: input.secure,
    },
    { verify: input.verify },
  );

  return ok({ account });
});

/** DELETE /api/accounts/:id */
export const DELETE = createRouteHandler<{ id: string }>('accounts.remove', async (_request, { params }) => {
  const id = requireParam(params, 'id');
  await accountService.remove(id);
  return ok({ id });
});
