/**
 * 邮件服务 —— 「拉取邮件 -> 精准提取验证码 -> 去重入库」的编排。
 */
import { config } from '../config';
import { AppError, toAppError } from '../errors';
import { logger } from '../logger';
import { extractVerificationCodes, type CodeCandidate } from '../mail/codeExtractor';
import { fetchRecentMessages } from '../mail/imapClient';
import { accountRepo, toPublicAccount } from '../repositories/accountRepo';
import { codeRepo, type CodeRecordInput } from '../repositories/codeRepo';
import type { CodeRecord, PublicMailAccount } from '../types';
import { accountService, resolveCredentials } from './accountService';

const log = logger.child({ module: 'mailService' });

export type MessageInsight = {
  uid: number;
  subject: string;
  from: string;
  receivedAt: string;
  /** 该邮件中提取到的候选验证码（按置信度降序） */
  candidates: CodeCandidate[];
};

export type BestCode = CodeCandidate & {
  subject: string;
  from: string;
  receivedAt: string;
};

export type FetchCodesResult = {
  account: PublicMailAccount;
  /** 实际拉取到的邮件数 */
  fetchedCount: number;
  /** 本地时间窗口（分钟） */
  windowMinutes: number;
  messages: MessageInsight[];
  /** 本次新入库的验证码记录（已按 messageId+code 去重） */
  newCodes: CodeRecord[];
  /** 跨全部邮件置信度最高的候选 */
  best: BestCode | null;
};

export type FetchCodesParams = {
  accountId: string;
  limit?: number;
  sinceMinutes?: number;
  /** 低于该置信度的候选不写入历史，默认 0.4 */
  minConfidence?: number;
};

export const mailService = {
  async fetchCodes(params: FetchCodesParams): Promise<FetchCodesResult> {
    const account = await accountService.getOrFail(params.accountId);

    const limit = Math.min(Math.max(params.limit ?? config.mail.fetchLimit, 1), config.mail.maxFetchLimit);
    const sinceMinutes = Math.min(
      Math.max(params.sinceMinutes ?? config.mail.defaultSinceMinutes, 1),
      config.mail.maxSinceMinutes,
    );
    const minConfidence = params.minConfidence ?? 0.4;

    let messages;
    try {
      messages = await fetchRecentMessages(resolveCredentials(account), { limit, sinceMinutes });
      await accountRepo.recordHealthCheck(account.id, 'ok', null);
    } catch (error) {
      const appError = toAppError(error);
      await accountRepo.recordHealthCheck(account.id, 'error', appError.message);
      throw appError;
    }

    const insights: MessageInsight[] = messages.map((message) => ({
      uid: message.uid,
      subject: message.subject,
      from: message.from,
      receivedAt: message.receivedAt,
      candidates: extractVerificationCodes({
        subject: message.subject,
        text: message.text,
        html: message.html,
        from: message.from,
      }),
    }));

    const pending: CodeRecordInput[] = [];
    let best: BestCode | null = null;

    insights.forEach((insight, index) => {
      const source = messages[index];
      if (!source) return;
      // 每封邮件只入库置信度最高的一条，避免噪声污染历史
      const top = insight.candidates.find((candidate) => candidate.confidence >= minConfidence);
      if (!top) return;

      pending.push({
        accountId: account.id,
        accountEmail: account.email,
        code: top.code,
        confidence: top.confidence,
        reason: top.reason,
        context: top.context,
        subject: source.subject,
        from: source.from,
        receivedAt: source.receivedAt,
        messageId: source.messageId,
      });

      if (!best || top.confidence > best.confidence) {
        best = {
          ...top,
          subject: source.subject,
          from: source.from,
          receivedAt: source.receivedAt,
        };
      }
    });

    const newCodes = await codeRepo.saveMany(pending);

    log.info('验证码提取完成', {
      accountId: account.id,
      email: account.email,
      fetched: messages.length,
      extracted: pending.length,
      saved: newCodes.length,
    });

    return {
      account: toPublicAccount(account),
      fetchedCount: messages.length,
      windowMinutes: sinceMinutes,
      messages: insights,
      newCodes,
      best,
    };
  },

  listCodes(options: { limit?: number; accountId?: string } = {}): Promise<CodeRecord[]> {
    return codeRepo.listRecent(options);
  },

  async removeCode(id: string): Promise<void> {
    const removed = await codeRepo.remove(id);
    if (!removed) throw AppError.notFound(`验证码记录不存在: ${id}`);
  },

  clearCodes(accountId?: string): Promise<number> {
    return codeRepo.clear(accountId);
  },
};
