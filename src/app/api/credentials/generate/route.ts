import { config } from '@/lib/config';
import { createRouteHandler, ok, readJsonBody } from '@/lib/http';
import { credentialService } from '@/lib/services/credentialService';
import { validateObject } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type GenerateBody = {
  count: number;
  /** 简化界面的用法：长度与用户名风格由后端随机，无需前端传 */
  randomize?: boolean;
  usernameLength?: number;
  passwordLength?: number;
  uppercase?: boolean;
  symbols?: boolean;
  digits?: boolean;
  excludeAmbiguous?: boolean;
  style?: 'random' | 'readable';
  emailDomain?: string;
  emailPrefix?: string;
  aliasSeparator?: string;
};

/** POST /api/credentials/generate —— 批量生成随机「账号 + 密码 (+ 邮箱别名)」 */
export const POST = createRouteHandler('credentials.generate', async (request) => {
  const body = await readJsonBody(request);
  const input = validateObject<GenerateBody>(body, {
    count: { type: 'int', required: true, min: 1, max: config.credential.maxBatch, label: '生成数量' },
    randomize: { type: 'boolean', label: '自动随机长度与风格' },
    usernameLength: {
      type: 'int',
      min: config.credential.usernameMinLength,
      max: config.credential.usernameMaxLength,
      label: '用户名长度',
    },
    passwordLength: {
      type: 'int',
      min: config.credential.passwordMinLength,
      max: config.credential.passwordMaxLength,
      label: '密码长度',
    },
    uppercase: { type: 'boolean', label: '包含大写字母' },
    symbols: { type: 'boolean', label: '包含符号' },
    digits: { type: 'boolean', label: '包含数字' },
    excludeAmbiguous: { type: 'boolean', label: '排除易混淆字符' },
    style: {
      type: 'string',
      max: 16,
      pattern: /^(random|readable)$/,
      patternMessage: '用户名风格只能是 random 或 readable',
      label: '用户名风格',
    },
    // 显式传空串表示"不生成邮箱"
    emailDomain: { type: 'string', max: 120, default: '', label: '邮箱域名' },
    emailPrefix: { type: 'string', max: 64, default: '', label: '邮箱前缀' },
    aliasSeparator: { type: 'string', max: 3, default: config.credential.defaults.aliasSeparator, label: '别名分隔符' },
  });

  const result = await credentialService.generate({
    count: input.count,
    randomize: input.randomize,
    usernameLength: input.usernameLength,
    passwordLength: input.passwordLength,
    uppercase: input.uppercase,
    symbols: input.symbols,
    digits: input.digits,
    excludeAmbiguous: input.excludeAmbiguous,
    style: input.style,
    emailDomain: input.emailDomain,
    emailPrefix: input.emailPrefix,
    aliasSeparator: input.aliasSeparator,
  });

  return ok(result, { status: 201 });
});
