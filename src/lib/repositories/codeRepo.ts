/**
 * 验证码历史仓储 —— 保存从邮件中提取出的验证码，便于回溯与去重。
 */
import { randomUUID } from 'node:crypto';
import { config } from '../config';
import type { CodeRecord } from '../types';
import { JsonCollection } from './jsonStore';

const collection = new JsonCollection<CodeRecord>('codes.json');

export type CodeRecordInput = Omit<CodeRecord, 'id' | 'createdAt'>;

export const codeRepo = {
  /** 按时间倒序返回，可按账号过滤 */
  async listRecent(options: { limit?: number; accountId?: string } = {}): Promise<CodeRecord[]> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const items = await collection.list();
    return items
      .filter((item) => (options.accountId ? item.accountId === options.accountId : true))
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt) || b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  },

  /**
   * 批量写入，按 (messageId + code) 去重；
   * 写入后自动裁剪历史长度，避免文件无限增长。
   */
  async saveMany(inputs: CodeRecordInput[]): Promise<CodeRecord[]> {
    if (inputs.length === 0) return [];
    const createdAt = new Date().toISOString();
    const records: CodeRecord[] = inputs.map((input) => ({
      ...input,
      id: randomUUID(),
      createdAt,
    }));

    return collection.mutate((items) => {
      const known = new Set(items.map((item) => `${item.messageId}::${item.code}`));
      const accepted: CodeRecord[] = [];
      for (const record of records) {
        const key = `${record.messageId}::${record.code}`;
        if (known.has(key)) continue;
        known.add(key);
        accepted.push(record);
      }
      const merged = [...items, ...accepted];
      // 按接收时间倒序裁剪到上限
      merged.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
      const pruned = merged.slice(0, config.history.maxCodeRecords);
      return { items: pruned, result: accepted };
    });
  },

  remove(id: string): Promise<boolean> {
    return collection.remove(id);
  },

  clear(accountId?: string): Promise<number> {
    if (!accountId) return collection.removeWhere(() => true);
    return collection.removeWhere((item) => item.accountId === accountId);
  },

  count(): Promise<number> {
    return collection.count();
  },
};
