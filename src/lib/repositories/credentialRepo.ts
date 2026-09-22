/**
 * 生成凭据仓储 —— 保存随机生成的「账号 + 密码」记录。
 * 密码以密文落盘（AES-256-GCM），仅在接口调用时解密返回。
 */
import { randomUUID } from 'node:crypto';
import { config } from '../config';
import type { CredentialRecord, PasswordStrength } from '../types';
import { JsonCollection } from './jsonStore';

const collection = new JsonCollection<CredentialRecord>('credentials.json');

export type CredentialRecordInput = {
  batchId: string;
  username: string;
  email: string;
  passwordEnc: string;
  strength: PasswordStrength;
};

export const credentialRepo = {
  async listRecent(options: { limit?: number; batchId?: string } = {}): Promise<CredentialRecord[]> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const items = await collection.list();
    return items
      .filter((item) => (options.batchId ? item.batchId === options.batchId : true))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  },

  async saveMany(inputs: CredentialRecordInput[]): Promise<CredentialRecord[]> {
    if (inputs.length === 0) return [];
    const createdAt = new Date().toISOString();
    const records: CredentialRecord[] = inputs.map((input) => ({
      id: randomUUID(),
      ...input,
      createdAt,
    }));

    return collection.mutate((items) => {
      const merged = [...items, ...records];
      merged.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const pruned = merged.slice(0, config.history.maxCredentialRecords);
      return { items: pruned, result: records };
    });
  },

  findById(id: string): Promise<CredentialRecord | undefined> {
    return collection.findById(id);
  },

  remove(id: string): Promise<boolean> {
    return collection.remove(id);
  },

  clear(): Promise<number> {
    return collection.removeWhere(() => true);
  },

  count(): Promise<number> {
    return collection.count();
  },
};
