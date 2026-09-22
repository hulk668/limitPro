/**
 * 对称加密工具 —— 用于加密落盘的邮箱密码与生成的账号密码。
 * 算法：AES-256-GCM（认证加密，防篡改）
 * 密钥：存放于数据目录下的 keyring 文件（0600），首次运行自动生成
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config, ensureDataDir } from './config';
import { AppError } from './errors';

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';
const KEY_FILE_NAME = 'keyring';
const KEY_LENGTH = 32;
const IV_LENGTH = 12;

let cachedKey: Buffer | null = null;

function keyFilePath(): string {
  return path.join(config.dataDir, KEY_FILE_NAME);
}

function loadKey(): Buffer {
  if (cachedKey) return cachedKey;
  ensureDataDir();
  const file = keyFilePath();

  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, 'utf8').trim();
    const key = Buffer.from(raw, 'base64');
    if (key.length !== KEY_LENGTH) {
      throw AppError.crypto('密钥环文件已损坏（长度不合法），请备份数据后删除 keyring 重新生成');
    }
    cachedKey = key;
    return key;
  }

  const key = randomBytes(KEY_LENGTH);
  fs.writeFileSync(file, `${key.toString('base64')}\n`, { encoding: 'utf8', mode: 0o600 });
  cachedKey = key;
  return key;
}

/** 加密：返回 `v1:iv:tag:ciphertext`（均为 base64） */
export function encryptSecret(plain: string): string {
  if (!plain) return '';
  const key = loadKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(':');
}

/** 解密 encryptSecret 的产物 */
export function decryptSecret(payload: string): string {
  if (!payload) return '';
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw AppError.crypto('密文格式不正确，无法解密');
  }
  const [, ivB64, tagB64, cipherB64] = parts;
  const key = loadKey();
  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(cipherB64, 'base64')),
      decipher.final(),
    ]);
    return plain.toString('utf8');
  } catch (error) {
    throw AppError.crypto('解密失败：密钥不匹配或数据已损坏', error);
  }
}

/** 用于界面展示的掩码，如 `ab****yz` */
export function maskSecret(value: string, visiblePrefix = 2, visibleSuffix = 2): string {
  if (!value) return '';
  if (value.length <= visiblePrefix + visibleSuffix) return '*'.repeat(value.length);
  return `${value.slice(0, visiblePrefix)}${'*'.repeat(Math.min(8, value.length - visiblePrefix - visibleSuffix))}${value.slice(-visibleSuffix)}`;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** 生成 URL 安全的随机标识（用于 id / batchId 的补充） */
export function randomToken(bytes = 16): string {
  return randomBytes(bytes).toString('base64url');
}
