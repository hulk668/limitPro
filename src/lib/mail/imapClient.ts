/**
 * IMAP 客户端封装。
 *
 * ⚠️ 2925 邮箱的关键差异（本模块存在的意义）：
 *   1. 服务器**不实现 IMAP SEARCH 命令**，调用 client.search() 会直接报错。
 *      因此这里统一采用「SELECT 取邮件总数 -> 按序号区间 FETCH -> 本地过滤」策略。
 *   2. 登录名必须是**主邮箱完整地址**，子邮箱/别名无法登录客户端。
 *   3. 官方推荐 993(SSL)，但部分线路仅开放 143(明文)，故端口与加密方式做成可配置。
 */
import { ImapFlow, type FetchMessageObject } from 'imapflow';
import { simpleParser } from 'mailparser';
import { config } from '../config';
import { AppError, toAppError } from '../errors';
import { logger } from '../logger';

export type ImapCredentials = {
  /** 主邮箱完整地址（同时作为 IMAP 登录名） */
  email: string;
  password: string;
  host: string;
  port: number;
  secure: boolean;
};

export type ParsedMessage = {
  uid: number;
  subject: string;
  from: string;
  receivedAt: string;
  text: string;
  html: string;
  messageId: string;
};

export type ConnectionInfo = {
  email: string;
  host: string;
  port: number;
  secure: boolean;
  /** INBOX 中的邮件总数 */
  messageCount: number;
};

const log = logger.child({ module: 'imapClient' });

function createClient(credentials: ImapCredentials): ImapFlow {
  const options: ConstructorParameters<typeof ImapFlow>[0] = {
    host: credentials.host,
    port: credentials.port,
    secure: credentials.secure,
    auth: { user: credentials.email, pass: credentials.password },
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: config.mail.timeoutMs,
    greetingTimeout: config.mail.timeoutMs,
    socketTimeout: config.mail.timeoutMs,
  };
  if (config.mail.allowInvalidCert) {
    options.tls = { rejectUnauthorized: false };
  }
  return new ImapFlow(options);
}

/** 把 imapflow 抛出的底层异常翻译为对用户友好的领域错误 */
function mapImapError(error: unknown, action: string): AppError {
  const candidate = error as {
    authenticationFailed?: boolean;
    code?: string;
    responseText?: string;
    message?: string;
  };
  const detail = candidate?.responseText || candidate?.message || String(error);

  if (candidate?.authenticationFailed) {
    return AppError.mailAuth(
      '邮箱认证失败：请确认使用「主邮箱完整地址 + 主邮箱密码」登录，并在网页端开启 IMAP 服务',
      { detail },
    );
  }
  if (candidate?.code === 'ENOTFOUND' || /getaddrinfo|ENOTFOUND/i.test(detail)) {
    return AppError.mailConnect(`无法解析邮箱服务器地址（${action}），请检查 IMAP 服务器域名`, { detail });
  }
  if (candidate?.code === 'ETIMEDOUT' || /timeout|timed out/i.test(detail)) {
    return AppError.mailConnect(
      `连接邮箱服务器超时（${action}）。若当前为 993+SSL，可尝试改为端口 143 并关闭 SSL；反之亦然`,
      { detail },
    );
  }
  if (candidate?.code === 'ECONNREFUSED' || /ECONNREFUSED|connection refused/i.test(detail)) {
    return AppError.mailConnect(`邮箱服务器拒绝连接（${action}），请确认端口与加密方式是否匹配`, { detail });
  }
  if (/Unexpected close|ECONNRESET|socket hang up|connection closed/i.test(detail)) {
    return AppError.mailConnect(
      `与邮箱服务器的连接被意外中断（${action}）。` +
        `若当前为「993 + SSL」，请改用「143 + 关闭 SSL」；反之亦然。部分 2925 线路的 993 端口并不支持 SSL/TLS。`,
      { detail },
    );
  }
  if (/Unknown command|BAD|SEARCH/i.test(detail)) {
    return AppError.mailFetch(
      `邮箱服务器不支持该 IMAP 指令（${action}）。本工具已规避 SEARCH 命令，如仍报错请联系邮箱服务商`,
      { detail },
    );
  }
  return AppError.mailFetch(`${action}失败：${detail}`, { detail });
}

/** 统一的连接生命周期管理：连接 -> 执行 -> 必定释放 */
async function withImap<T>(
  credentials: ImapCredentials,
  action: string,
  task: (client: ImapFlow) => Promise<T>,
): Promise<T> {
  const client = createClient(credentials);
  let connected = false;
  try {
    await client.connect();
    connected = true;
    return await task(client);
  } catch (error) {
    const appError = toAppError(error);
    // 如果已经是本模块翻译过的领域错误则直接抛出，避免二次包装
    if (appError.code.startsWith('MAIL_')) throw appError;
    throw mapImapError(error, action);
  } finally {
    try {
      if (connected) {
        await Promise.race([
          client.logout(),
          new Promise((resolve) => setTimeout(resolve, 3000)),
        ]);
      } else {
        client.close();
      }
    } catch (error) {
      log.debug('关闭 IMAP 连接时出现异常（已忽略）', { error });
    }
  }
}

/* -------------------------------------------------------------------------- */
/* 对外能力                                                                    */
/* -------------------------------------------------------------------------- */

/** 测试账号连通性，返回邮箱基本信息 */
export async function testConnection(credentials: ImapCredentials): Promise<ConnectionInfo> {
  const info = await withImap(credentials, '连接测试', async (client) => {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const mailbox = client.mailbox;
      const messageCount = mailbox && typeof mailbox === 'object' ? mailbox.exists ?? 0 : 0;
      return {
        email: credentials.email,
        host: credentials.host,
        port: credentials.port,
        secure: credentials.secure,
        messageCount,
      };
    } finally {
      lock.release();
    }
  });
  log.info('IMAP 连接测试成功', {
    email: credentials.email,
    host: credentials.host,
    port: credentials.port,
    messageCount: info.messageCount,
  });
  return info;
}

/**
 * 拉取最近若干封邮件。
 *
 * 注意：因为 2925 不支持 SEARCH，这里不使用任何服务端过滤条件，
 * 而是先取 INBOX 邮件总数，再 FETCH 末尾 N 封，最后在本地按时间过滤。
 */
export async function fetchRecentMessages(
  credentials: ImapCredentials,
  options: { limit: number; sinceMinutes?: number },
): Promise<ParsedMessage[]> {
  const limit = Math.min(Math.max(options.limit, 1), config.mail.maxFetchLimit);

  const messages = await withImap(credentials, '拉取邮件', async (client) => {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const mailbox = client.mailbox;
      const total = mailbox && typeof mailbox === 'object' ? mailbox.exists ?? 0 : 0;
      if (total === 0) return [];

      const start = Math.max(1, total - limit + 1);
      const range = `${start}:${total}`;
      const collected: ParsedMessage[] = [];

      for await (const message of client.fetch(
        range,
        { uid: true, envelope: true, source: true, internalDate: true },
        { uid: false },
      )) {
        collected.push(await parseMessage(message, credentials.email));
      }
      return collected;
    } finally {
      lock.release();
    }
  });

  const sorted = messages.sort(
    (a, b) => b.receivedAt.localeCompare(a.receivedAt) || b.uid - a.uid,
  );

  if (!options.sinceMinutes || options.sinceMinutes <= 0) return sorted;

  const threshold = Date.now() - options.sinceMinutes * 60_000;
  return sorted.filter((message) => new Date(message.receivedAt).getTime() >= threshold);
}

/* -------------------------------------------------------------------------- */
/* 内部工具                                                                    */
/* -------------------------------------------------------------------------- */

function formatAddress(list?: Array<{ name?: string; address?: string }>): string {
  if (!list || list.length === 0) return '';
  const first = list[0];
  if (!first) return '';
  return first.name ? `${first.name} <${first.address ?? ''}>` : first.address ?? '';
}

function parsedAddressText(from: unknown): string {
  if (!from) return '';
  if (Array.isArray(from)) {
    const first = from[0] as { text?: string } | undefined;
    return first?.text ?? '';
  }
  return (from as { text?: string }).text ?? '';
}

function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

async function parseMessage(message: FetchMessageObject, fallbackAddress: string): Promise<ParsedMessage> {
  let subject = message.envelope?.subject ?? '';
  let from = formatAddress(message.envelope?.from);
  let text = '';
  let html = '';
  let messageId = `${fallbackAddress}-${message.uid}`;
  let date = toDate(message.internalDate);

  if (message.source) {
    const parsed = await simpleParser(message.source);
    subject = subject || parsed.subject || '';
    from = from || parsedAddressText(parsed.from);
    text = typeof parsed.text === 'string' ? parsed.text : '';
    html = typeof parsed.html === 'string' ? parsed.html : '';
    if (parsed.messageId) messageId = parsed.messageId;
    if (parsed.date) date = toDate(parsed.date);
  }

  return {
    uid: message.uid,
    subject,
    from,
    receivedAt: date.toISOString(),
    text,
    html,
    messageId,
  };
}
