/**
 * 邮箱账号服务 —— 账号 CRUD 与连通性检测的编排。
 * 服务层不依赖任何 HTTP 类型，可被 API 路由、定时任务或 CLI 复用。
 */
import { config } from '../config';
import { decryptSecret, encryptSecret } from '../crypto';
import { AppError } from '../errors';
import { logger } from '../logger';
import { testConnection, type ConnectionInfo, type ImapCredentials } from '../mail/imapClient';
import { accountRepo, toPublicAccount } from '../repositories/accountRepo';
import type { MailAccount, MailAccountCreateInput, PublicMailAccount } from '../types';

const log = logger.child({ module: 'accountService' });

function normalizeInput(input: MailAccountCreateInput) {
  return {
    label: (input.label ?? '').trim() || input.email.trim(),
    email: input.email.trim().toLowerCase(),
    imapHost: (input.imapHost ?? '').trim() || config.mail.defaults.host,
    imapPort: input.imapPort ?? config.mail.defaults.port,
    secure: input.secure ?? config.mail.defaults.secure,
  };
}

/** 从落盘记录还原可用的 IMAP 凭据（解密密码） */
export function resolveCredentials(account: MailAccount): ImapCredentials {
  return {
    email: account.email,
    password: decryptSecret(account.passwordEnc),
    host: account.imapHost,
    port: account.imapPort,
    secure: account.secure,
  };
}

export const accountService = {
  async list(): Promise<PublicMailAccount[]> {
    const accounts = await accountRepo.list();
    return accounts.map(toPublicAccount);
  },

  async getOrFail(id: string): Promise<MailAccount> {
    const account = await accountRepo.findById(id);
    if (!account) throw AppError.notFound(`邮箱账号不存在: ${id}`);
    return account;
  },

  /**
   * 新增账号。
   * 默认先做一次真实连通性检测：凭据错误时立即失败，不把坏数据写进库。
   */
  async create(input: MailAccountCreateInput, options: { verify?: boolean } = {}): Promise<PublicMailAccount> {
    const normalized = normalizeInput(input);
    const shouldVerify = options.verify !== false;

    const duplicated = await accountRepo.findByEmail(normalized.email);
    if (duplicated) {
      throw AppError.conflict(`该邮箱已存在: ${normalized.email}`);
    }

    if (shouldVerify) {
      await testConnection({
        email: normalized.email,
        password: input.password,
        host: normalized.imapHost,
        port: normalized.imapPort,
        secure: normalized.secure,
      });
    }

    const account = await accountRepo.create({
      ...normalized,
      passwordEnc: encryptSecret(input.password),
    });

    if (shouldVerify) {
      await accountRepo.recordHealthCheck(account.id, 'ok', null);
    }

    log.info('新增邮箱账号', { id: account.id, email: account.email, host: account.imapHost, port: account.imapPort });
    return toPublicAccount(account);
  },

  /** 修改账号（label / 服务器参数 / 密码），改密码会重新做一次连通性检测 */
  async update(
    id: string,
    patch: Partial<MailAccountCreateInput>,
    options: { verify?: boolean } = {},
  ): Promise<PublicMailAccount> {
    const existing = await accountService.getOrFail(id);

    const nextHost = (patch.imapHost ?? '').trim() || existing.imapHost;
    const nextPort = patch.imapPort ?? existing.imapPort;
    const nextSecure = patch.secure ?? existing.secure;
    const nextEmail = (patch.email ?? existing.email).trim().toLowerCase();
    const nextPassword = patch.password?.trim();

    if (nextEmail !== existing.email) {
      const duplicated = await accountRepo.findByEmail(nextEmail);
      if (duplicated && duplicated.id !== id) {
        throw AppError.conflict(`该邮箱已存在: ${nextEmail}`);
      }
    }

    if (options.verify !== false) {
      await testConnection({
        email: nextEmail,
        password: nextPassword || decryptSecret(existing.passwordEnc),
        host: nextHost,
        port: nextPort,
        secure: nextSecure,
      });
    }

    const updated = await accountRepo.update(id, {
      ...(patch.label === undefined ? {} : { label: patch.label.trim() || nextEmail }),
      email: nextEmail,
      imapHost: nextHost,
      imapPort: nextPort,
      secure: nextSecure,
      ...(nextPassword ? { passwordEnc: encryptSecret(nextPassword) } : {}),
    });

    log.info('更新邮箱账号', { id, email: updated.email });
    return toPublicAccount(updated);
  },

  async remove(id: string): Promise<void> {
    const removed = await accountRepo.remove(id);
    if (!removed) throw AppError.notFound(`邮箱账号不存在: ${id}`);
    log.info('删除邮箱账号', { id });
  },

  /** 手动触发连通性检测，并把结果写回账号（用于界面上的状态徽标） */
  async test(id: string): Promise<{ account: PublicMailAccount; connection: ConnectionInfo }> {
    const account = await accountService.getOrFail(id);
    try {
      const connection = await testConnection(resolveCredentials(account));
      const updated = await accountRepo.recordHealthCheck(id, 'ok', null);
      return { account: toPublicAccount(updated), connection };
    } catch (error) {
      const message = error instanceof AppError ? error.message : '连接失败';
      await accountRepo.recordHealthCheck(id, 'error', message);
      throw error;
    }
  },
};
