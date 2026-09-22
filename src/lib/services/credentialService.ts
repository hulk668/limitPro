/**
 * 凭据服务 —— 随机账号/密码的生成与历史管理。
 * 生成的密码以 AES-256-GCM 密文落盘，仅在读取时解密。
 */
import { randomInt, randomUUID } from 'node:crypto';
import { generateCredentials, type GenerateOptions, type UsernameStyle } from '../account/generator';
import { config } from '../config';
import { decryptSecret, encryptSecret } from '../crypto';
import { AppError } from '../errors';
import { logger } from '../logger';
import { credentialRepo } from '../repositories/credentialRepo';
import type { CredentialRecord, PublicCredentialRecord } from '../types';

const log = logger.child({ module: 'credentialService' });

export type GenerateCredentialsParams = {
  count: number;
  /**
   * true 时忽略显式传入的长度与风格，改为每次生成时随机取值：
   * 用户名长度 / 密码长度在 config.credential.auto 区间内随机、用户名风格在 readable|random 中二选一。
   * 供「简化界面」使用 —— 用户只需选数量与邮箱，其余交给随机。
   */
  randomize?: boolean;
  usernameLength?: number;
  passwordLength?: number;
  uppercase?: boolean;
  symbols?: boolean;
  digits?: boolean;
  excludeAmbiguous?: boolean;
  style?: UsernameStyle;
  /** 邮箱域名，留空表示只生成用户名不生成邮箱 */
  emailDomain?: string;
  /** 2925 主邮箱前缀，配合别名分隔符拼出 prefix_username@domain */
  emailPrefix?: string;
  aliasSeparator?: string;
};

export type GenerateCredentialsResult = {
  batchId: string;
  createdAt: string;
  count: number;
  credentials: PublicCredentialRecord[];
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** 在 [min, max] 闭区间内取随机整数（CSPRNG，不污染全局随机源） */
function randomBetween(min: number, max: number): number {
  return max <= min ? min : randomInt(min, max + 1);
}

/**
 * 解析「自动随机」参数：长度取「合法区间 ∩ auto 推荐区间」内的随机值，用户名风格二选一。
 * 交集保证即使配置被改窄也不会越界。
 */
function resolveAutoOptions(): { usernameLength: number; passwordLength: number; style: UsernameStyle } {
  const { auto, usernameMinLength, usernameMaxLength, passwordMinLength, passwordMaxLength } = config.credential;
  return {
    usernameLength: randomBetween(
      Math.max(usernameMinLength, auto.usernameMin),
      Math.min(usernameMaxLength, auto.usernameMax),
    ),
    passwordLength: randomBetween(
      Math.max(passwordMinLength, auto.passwordMin),
      Math.min(passwordMaxLength, auto.passwordMax),
    ),
    style: randomInt(0, 2) === 0 ? 'random' : 'readable',
  };
}

function toPublic(record: CredentialRecord, password: string): PublicCredentialRecord {
  const { passwordEnc: _passwordEnc, ...rest } = record;
  return { ...rest, password };
}

export const credentialService = {
  async generate(params: GenerateCredentialsParams): Promise<GenerateCredentialsResult> {
    const defaults = config.credential.defaults;
    const randomize = params.randomize === true;
    const auto = randomize ? resolveAutoOptions() : null;

    const options: GenerateOptions = {
      count: clamp(Math.trunc(params.count), 1, config.credential.maxBatch),
      usernameLength: auto
        ? auto.usernameLength
        : clamp(
            Math.trunc(params.usernameLength ?? defaults.usernameLength),
            config.credential.usernameMinLength,
            config.credential.usernameMaxLength,
          ),
      passwordLength: auto
        ? auto.passwordLength
        : clamp(
            Math.trunc(params.passwordLength ?? defaults.passwordLength),
            config.credential.passwordMinLength,
            config.credential.passwordMaxLength,
          ),
      // 字符集类开关：未显式传入时一律走默认配置（界面已不再暴露这些选项）
      uppercase: params.uppercase ?? defaults.uppercase,
      symbols: params.symbols ?? defaults.symbols,
      digits: params.digits ?? defaults.digits,
      excludeAmbiguous: params.excludeAmbiguous ?? defaults.excludeAmbiguous,
      style: auto ? auto.style : (params.style ?? 'readable'),
      emailDomain: (params.emailDomain ?? defaults.emailDomain).trim(),
      emailPrefix: (params.emailPrefix ?? '').trim(),
      aliasSeparator: params.aliasSeparator ?? defaults.aliasSeparator,
    };

    const generated = generateCredentials(options);
    if (generated.length === 0) {
      throw AppError.internal('生成凭据失败：结果为空');
    }

    const batchId = randomUUID();
    const saved = await credentialRepo.saveMany(
      generated.map((item) => ({
        batchId,
        username: item.username,
        email: item.email,
        passwordEnc: encryptSecret(item.password),
        strength: item.strength,
      })),
    );

    // 用用户名关联明文密码，避免依赖数组下标
    const plaintextByUsername = new Map(generated.map((item) => [item.username, item.password]));
    const credentials = saved.map((record) =>
      toPublic(record, plaintextByUsername.get(record.username) ?? decryptSecret(record.passwordEnc)),
    );

    log.info('生成随机凭据', {
      batchId,
      count: credentials.length,
      randomize,
      usernameLength: options.usernameLength,
      passwordLength: options.passwordLength,
      style: options.style,
      emailDomain: options.emailDomain || null,
    });

    return {
      batchId,
      createdAt: saved[0]?.createdAt ?? new Date().toISOString(),
      count: credentials.length,
      credentials,
    };
  },

  async list(limit = 50): Promise<PublicCredentialRecord[]> {
    const records = await credentialRepo.listRecent({ limit });
    return records.map((record) => toPublic(record, decryptSecret(record.passwordEnc)));
  },

  async remove(id: string): Promise<void> {
    const removed = await credentialRepo.remove(id);
    if (!removed) throw AppError.notFound(`生成记录不存在: ${id}`);
  },

  clear(): Promise<number> {
    return credentialRepo.clear();
  },
};
