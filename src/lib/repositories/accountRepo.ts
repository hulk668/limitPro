/**
 * 邮箱账号仓储 —— 仅负责数据存取，不含任何业务逻辑与加解密。
 */
import { randomUUID } from 'node:crypto';
import type { AccountStatus, MailAccount, PublicMailAccount } from '../types';
import { JsonCollection } from './jsonStore';

const collection = new JsonCollection<MailAccount>('accounts.json');

export type CreateAccountRecord = {
  label: string;
  email: string;
  imapHost: string;
  imapPort: number;
  secure: boolean;
  passwordEnc: string;
};

/** 剔除密文字段，用于对外返回 */
export function toPublicAccount(account: MailAccount): PublicMailAccount {
  const { passwordEnc: _passwordEnc, ...rest } = account;
  return rest;
}

export const accountRepo = {
  list(): Promise<MailAccount[]> {
    return collection.list();
  },

  listPublic(): Promise<PublicMailAccount[]> {
    return collection.list().then((items) => items.map(toPublicAccount));
  },

  findById(id: string): Promise<MailAccount | undefined> {
    return collection.findById(id);
  },

  findByEmail(email: string): Promise<MailAccount | undefined> {
    const target = email.trim().toLowerCase();
    return collection.find((item) => item.email.toLowerCase() === target);
  },

  async create(input: CreateAccountRecord): Promise<MailAccount> {
    const now = new Date().toISOString();
    const account: MailAccount = {
      id: randomUUID(),
      label: input.label,
      email: input.email,
      imapHost: input.imapHost,
      imapPort: input.imapPort,
      secure: input.secure,
      passwordEnc: input.passwordEnc,
      createdAt: now,
      updatedAt: now,
      lastCheckedAt: null,
      lastStatus: 'unknown',
      lastError: null,
    };
    return collection.insert(account);
  },

  update(
    id: string,
    patch: Partial<Pick<MailAccount, 'label' | 'email' | 'imapHost' | 'imapPort' | 'secure' | 'passwordEnc'>>,
  ): Promise<MailAccount> {
    return collection.update(id, { ...patch, updatedAt: new Date().toISOString() });
  },

  /** 记录一次连通性检测结果 */
  recordHealthCheck(id: string, status: AccountStatus, error: string | null): Promise<MailAccount> {
    return collection.update(id, {
      lastStatus: status,
      lastError: error,
      lastCheckedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  },

  remove(id: string): Promise<boolean> {
    return collection.remove(id);
  },

  count(): Promise<number> {
    return collection.count();
  },
};
