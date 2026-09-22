/**
 * 通用 JSON 集合仓储基座。
 *
 * 为什么不用 SQLite：桌面端单机场景数据量小（账号/验证码历史），
 * 用 JSON 文件可避免 better-sqlite3 在 Electron 下的原生模块重编译问题。
 * 通过本文件统一封装「原子写 + 写操作串行化」，仓储层实现保持可替换
 * （未来切换 SQLite 只需替换本层实现，服务层无感知）。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { config, ensureDataDir } from '../config';
import { AppError } from '../errors';

type DocumentShape<T> = {
  version: number;
  updatedAt: string;
  items: T[];
};

export class JsonCollection<T extends { id: string }> {
  /** 写操作串行队列，避免并发写导致内容互相覆盖 */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly fileName: string) {}

  private get filePath(): string {
    return path.join(config.dataDir, this.fileName);
  }

  private async readAll(): Promise<T[]> {
    ensureDataDir();
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      if (!raw.trim()) return [];
      const parsed = JSON.parse(raw) as Partial<DocumentShape<T>>;
      return Array.isArray(parsed.items) ? (parsed.items as T[]) : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      if (error instanceof SyntaxError) {
        throw AppError.storage(`数据文件内容已损坏，无法解析: ${this.fileName}`);
      }
      throw AppError.storage(`读取数据文件失败: ${this.fileName}`, error);
    }
  }

  /** 先写临时文件再 rename，保证不会出现半截文件 */
  private async writeAll(items: T[]): Promise<void> {
    ensureDataDir();
    const document: DocumentShape<T> = {
      version: 1,
      updatedAt: new Date().toISOString(),
      items,
    };
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await fs.writeFile(tempPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
      await fs.rename(tempPath, this.filePath);
    } catch (error) {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
      throw AppError.storage(`写入数据文件失败: ${this.fileName}`, error);
    }
  }

  private enqueue<R>(task: () => Promise<R>): Promise<R> {
    const run = this.chain.then(task, task);
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /* ------------------------------- 读操作（串行化保证一致性） ------------------------------ */

  list(): Promise<T[]> {
    return this.enqueue(() => this.readAll());
  }

  count(): Promise<number> {
    return this.enqueue(async () => (await this.readAll()).length);
  }

  findById(id: string): Promise<T | undefined> {
    return this.enqueue(async () => (await this.readAll()).find((item) => item.id === id));
  }

  find(predicate: (item: T) => boolean): Promise<T | undefined> {
    return this.enqueue(async () => (await this.readAll()).find(predicate));
  }

  filter(predicate: (item: T) => boolean): Promise<T[]> {
    return this.enqueue(async () => (await this.readAll()).filter(predicate));
  }

  /* --------------------------------- 写操作 --------------------------------- */

  insert(item: T): Promise<T> {
    return this.enqueue(async () => {
      const items = await this.readAll();
      if (items.some((existing) => existing.id === item.id)) {
        throw AppError.conflict(`记录已存在: ${item.id}`);
      }
      items.push(item);
      await this.writeAll(items);
      return item;
    });
  }

  /** 批量插入（调用方需自行保证 id 唯一） */
  insertMany(newItems: T[]): Promise<T[]> {
    return this.enqueue(async () => {
      if (newItems.length === 0) return [];
      const items = await this.readAll();
      const existingIds = new Set(items.map((item) => item.id));
      const accepted = newItems.filter((item) => !existingIds.has(item.id));
      if (accepted.length === 0) return [];
      await this.writeAll([...items, ...accepted]);
      return accepted;
    });
  }

  update(id: string, patch: Partial<T>): Promise<T> {
    return this.enqueue(async () => {
      const items = await this.readAll();
      const index = items.findIndex((item) => item.id === id);
      if (index < 0) throw AppError.notFound(`记录不存在: ${id}`);
      const next = { ...items[index], ...patch } as T;
      items[index] = next;
      await this.writeAll(items);
      return next;
    });
  }

  remove(id: string): Promise<boolean> {
    return this.enqueue(async () => {
      const items = await this.readAll();
      const next = items.filter((item) => item.id !== id);
      if (next.length === items.length) return false;
      await this.writeAll(next);
      return true;
    });
  }

  removeWhere(predicate: (item: T) => boolean): Promise<number> {
    return this.enqueue(async () => {
      const items = await this.readAll();
      const next = items.filter((item) => !predicate(item));
      const removed = items.length - next.length;
      if (removed > 0) await this.writeAll(next);
      return removed;
    });
  }

  /**
   * 自定义原子变更：回调拿到当前全量数据并返回新数组，
   * 整个过程在写锁内完成，避免读-改-写竞态。
   */
  mutate<R>(task: (items: T[]) => { items: T[]; result: R }): Promise<R> {
    return this.enqueue(async () => {
      const items = await this.readAll();
      const { items: nextItems, result } = task(items);
      await this.writeAll(nextItems);
      return result;
    });
  }
}
