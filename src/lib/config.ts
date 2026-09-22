/**
 * 集中式配置 —— 全部来源为环境变量，并在启动时集中校验、快速失败。
 * 密钥类信息不进入本模块（邮箱密码由界面录入并加密落盘）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { AppError } from './errors';

function optional(key: string): string | undefined {
  const raw = process.env[key];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}

function readString(key: string, fallback: string): string {
  return optional(key) ?? fallback;
}

function readInt(key: string, fallback: number): number {
  const raw = optional(key);
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    throw AppError.internal(`环境变量 ${key} 必须是整数，当前值: "${raw}"`);
  }
  return parsed;
}

function readBool(key: string, fallback: boolean): boolean {
  const raw = optional(key);
  if (raw === undefined) return fallback;
  const normalized = raw.toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  throw AppError.internal(`环境变量 ${key} 必须是布尔值 (true/false)，当前值: "${raw}"`);
}

const nodeEnv = readString('NODE_ENV', 'development');

export const config = {
  appName: 'limitPro',
  nodeEnv,
  isProduction: nodeEnv === 'production',
  isDevelopment: nodeEnv !== 'production',
  logLevel: readString('LIMITPRO_LOG_LEVEL', nodeEnv === 'production' ? 'info' : 'debug'),

  /** 数据目录：账号库、验证码历史、生成记录、密钥环 */
  dataDir: optional('LIMITPRO_DATA_DIR') ?? path.join(process.cwd(), '.data'),

  server: {
    port: readInt('PORT', 3210),
    host: readString('HOSTNAME', '127.0.0.1'),
  },

  mail: {
    /** 默认 IMAP 参数（2925 邮箱） */
    defaults: {
      host: readString('LIMITPRO_IMAP_HOST', 'imap.2925.com'),
      port: readInt('LIMITPRO_IMAP_PORT', 993),
      /** true = 993 SSL/TLS；false = 143 明文 */
      secure: readBool('LIMITPRO_IMAP_SECURE', true),
    },
    provider: '2925 邮箱',
    /**
     * 2925 的 IMAP 服务不实现 SEARCH 命令，
     * 因此统一走「SELECT 取总数 -> 按序号 FETCH -> 本地过滤」策略。
     */
    disableServerSearch: readBool('LIMITPRO_IMAP_DISABLE_SEARCH', true),
    timeoutMs: readInt('LIMITPRO_IMAP_TIMEOUT_MS', 20_000),
    allowInvalidCert: readBool('LIMITPRO_IMAP_ALLOW_INVALID_CERT', false),
    fetchLimit: readInt('LIMITPRO_MAIL_FETCH_LIMIT', 30),
    maxFetchLimit: 100,
    /** 拉取后只看最近多少分钟内的邮件（本地过滤，因为不能用 SEARCH） */
    defaultSinceMinutes: 60,
    maxSinceMinutes: 24 * 60,
  },

  credential: {
    maxBatch: 50,
    usernameMinLength: 6,
    usernameMaxLength: 32,
    passwordMinLength: 8,
    passwordMaxLength: 64,
    /**
     * 「自动随机」区间：界面简化后不再让用户填长度与风格，
     * 每次生成时在下面区间内随机取值（会与上面的合法区间取交集）。
     * 刻意不用 6~32 / 8~64 的全量区间 —— 过短不安全、过长不便粘贴到目标站点。
     */
    auto: {
      usernameMin: 8,
      usernameMax: 14,
      passwordMin: 14,
      passwordMax: 20,
    },
    defaults: {
      usernameLength: 12,
      passwordLength: 16,
      symbols: true,
      digits: true,
      uppercase: true,
      excludeAmbiguous: true,
      emailDomain: '2925.com',
      aliasSeparator: '_',
    },
  },

  history: {
    maxCodeRecords: 800,
    maxCredentialRecords: 800,
  },
} as const;

export type AppConfig = typeof config;

/** 确保数据目录存在（幂等） */
export function ensureDataDir(): void {
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
  } catch (error) {
    throw AppError.storage(`无法创建数据目录: ${config.dataDir}`, error);
  }
}

/** 启动时集中校验配置，失败即快速失败 */
export function validateConfig(): void {
  if (!path.isAbsolute(config.dataDir)) {
    throw AppError.internal(`LIMITPRO_DATA_DIR 必须是绝对路径，当前值: "${config.dataDir}"`);
  }
  const { port, host } = config.server;
  if (port < 0 || port > 65_535) {
    throw AppError.internal(`PORT 超出合法范围: ${port}`);
  }
  if (!host) {
    throw AppError.internal('HOSTNAME 不能为空');
  }
  const { defaults, timeoutMs, fetchLimit, maxFetchLimit } = config.mail;
  if (defaults.port < 1 || defaults.port > 65_535) {
    throw AppError.internal(`LIMITPRO_IMAP_PORT 超出合法范围: ${defaults.port}`);
  }
  if (timeoutMs < 1_000) {
    throw AppError.internal(`LIMITPRO_IMAP_TIMEOUT_MS 不得小于 1000，当前值: ${timeoutMs}`);
  }
  if (fetchLimit < 1 || fetchLimit > maxFetchLimit) {
    throw AppError.internal(`LIMITPRO_MAIL_FETCH_LIMIT 取值区间为 1~${maxFetchLimit}，当前值: ${fetchLimit}`);
  }
  const credential = config.credential;
  if (credential.usernameMinLength > credential.usernameMaxLength) {
    throw AppError.internal('用户名长度区间非法：min 不得大于 max');
  }
  if (credential.passwordMinLength > credential.passwordMaxLength) {
    throw AppError.internal('密码长度区间非法：min 不得大于 max');
  }
  if (credential.auto.usernameMin > credential.auto.usernameMax) {
    throw AppError.internal('自动随机用户名长度区间非法：min 不得大于 max');
  }
  if (credential.auto.passwordMin > credential.auto.passwordMax) {
    throw AppError.internal('自动随机密码长度区间非法：min 不得大于 max');
  }
  ensureDataDir();
}
