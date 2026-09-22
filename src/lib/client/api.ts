/**
 * 前端 API 客户端 —— 类型化 fetch 封装。
 * 约定：
 *  - 所有请求走同源相对路径（Next.js 后端与页面同一进程）
 *  - 4xx 不重试；5xx 与网络错误退避重试（最多 3 次）
 *  - 后端错误统一映射为 ApiError，界面只需展示 message
 */
import type { CodeCandidate } from '@/lib/mail/codeExtractor';
import type {
  CodeRecord,
  PasswordStrength,
  PublicCredentialRecord,
  PublicMailAccount,
} from '@/lib/types';

/* --------------------------------- 类型 ---------------------------------- */

export type HealthInfo = {
  status: string;
  app: string;
  version: string;
  nodeEnv: string;
  uptimeSeconds: number;
  dataDir: string;
  storage: { accounts: number; codes: number; credentials: number };
};

export type MetaInfo = {
  app: { name: string; nodeEnv: string };
  mail: {
    provider: string;
    defaults: { host: string; port: number; secure: boolean };
    fetchLimit: number;
    maxFetchLimit: number;
    defaultSinceMinutes: number;
    maxSinceMinutes: number;
    disableServerSearch: boolean;
  };
  credential: {
    maxBatch: number;
    usernameMinLength: number;
    usernameMaxLength: number;
    passwordMinLength: number;
    passwordMaxLength: number;
    defaults: {
      usernameLength: number;
      passwordLength: number;
      symbols: boolean;
      digits: boolean;
      uppercase: boolean;
      excludeAmbiguous: boolean;
      emailDomain: string;
      aliasSeparator: string;
    };
  };
};

export type ConnectionInfo = {
  email: string;
  host: string;
  port: number;
  secure: boolean;
  messageCount: number;
};

export type MessageInsight = {
  uid: number;
  subject: string;
  from: string;
  receivedAt: string;
  candidates: CodeCandidate[];
};

export type FetchCodesResult = {
  account: PublicMailAccount;
  fetchedCount: number;
  windowMinutes: number;
  messages: MessageInsight[];
  newCodes: CodeRecord[];
  best: (CodeCandidate & { subject: string; from: string; receivedAt: string }) | null;
};

export type GenerateCredentialsResult = {
  batchId: string;
  createdAt: string;
  count: number;
  credentials: PublicCredentialRecord[];
};

/**
 * 生成凭据的请求体。
 * 简化界面只需传 count + randomize + 邮箱相关字段；
 * 长度、风格与字符集开关都可省略（后端一律按默认值 / 随机值处理）。
 */
export type GenerateCredentialsPayload = {
  count: number;
  randomize?: boolean;
  usernameLength?: number;
  passwordLength?: number;
  uppercase?: boolean;
  symbols?: boolean;
  digits?: boolean;
  excludeAmbiguous?: boolean;
  style?: 'random' | 'readable';
  emailDomain?: string;
  emailPrefix?: string;
  aliasSeparator?: string;
};

export type DataDirInfo = {
  /** 后端正在使用的数据目录绝对路径 */
  path: string;
  exists: boolean;
  /** 该目录下的一级条目数 */
  entryCount: number;
  /** 路径来源：环境变量 LIMITPRO_DATA_DIR 或默认的 <cwd>/.data */
  source: 'LIMITPRO_DATA_DIR' | 'default';
  nodeEnv: string;
  /** 是否已交给系统文件管理器打开 */
  opened: boolean;
  /** 实际调用的打开命令 */
  command: string | null;
};

export type CreateAccountPayload = {
  label?: string;
  email: string;
  password: string;
  imapHost?: string;
  imapPort?: number;
  secure?: boolean;
  verify?: boolean;
};

export type { CodeRecord, PasswordStrength, PublicCredentialRecord, PublicMailAccount };

/* ------------------------------- 错误类型 -------------------------------- */

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(message: string, code: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }

  /** 字段级校验错误（后端 VALIDATION_ERROR 时返回） */
  get fieldErrors(): Record<string, string> {
    const fields = (this.details as { fields?: Record<string, string> } | undefined)?.fields;
    return fields ?? {};
  }

  get isOffline(): boolean {
    return this.code === 'NETWORK_ERROR';
  }
}

/* ------------------------------- 请求实现 -------------------------------- */

const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 300;

export function describeApiError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return '发生未知错误';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const method = options.method ?? 'GET';
  let lastError: ApiError | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(path, {
        method,
        headers: options.body === undefined ? undefined : { 'content-type': 'application/json' },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        cache: 'no-store',
        signal: options.signal,
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      lastError = new ApiError('无法连接本地后端服务，请确认应用已正常启动', 'NETWORK_ERROR', 0);
      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_BASE_DELAY_MS * attempt);
        continue;
      }
      throw lastError;
    }

    const raw = await response.text();
    let payload: { ok: true; data: T } | { ok: false; error: { code: string; message: string; details?: unknown } } | null =
      null;
    if (raw.trim()) {
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = null;
      }
    }

    if (response.ok && payload && payload.ok) return payload.data;

    lastError = new ApiError(
      payload && !payload.ok ? payload.error.message : `请求失败（HTTP ${response.status}）`,
      payload && !payload.ok ? payload.error.code : 'HTTP_ERROR',
      response.status,
      payload && !payload.ok ? payload.error.details : undefined,
    );

    const retryable = response.status >= 500;
    if (!retryable || attempt === MAX_ATTEMPTS) throw lastError;
    await sleep(RETRY_BASE_DELAY_MS * attempt);
  }

  throw lastError ?? new ApiError('请求失败', 'UNKNOWN_ERROR', 0);
}

/* ------------------------------- 端点 ----------------------------------- */

export const api = {
  health: () => request<HealthInfo>('/api/health'),
  meta: () => request<MetaInfo>('/api/meta'),

  accounts: {
    list: () => request<{ accounts: PublicMailAccount[]; defaults: MetaInfo['mail']['defaults'] }>('/api/accounts'),
    create: (payload: CreateAccountPayload) =>
      request<{ account: PublicMailAccount }>('/api/accounts', { method: 'POST', body: payload }),
    update: (id: string, payload: Partial<CreateAccountPayload>) =>
      request<{ account: PublicMailAccount }>(`/api/accounts/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: payload,
      }),
    remove: (id: string) =>
      request<{ id: string }>(`/api/accounts/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    test: (id: string) =>
      request<{ account: PublicMailAccount; connection: ConnectionInfo }>(
        `/api/accounts/${encodeURIComponent(id)}/test`,
        { method: 'POST' },
      ),
  },

  mail: {
    fetchCodes: (payload: { accountId: string; limit?: number; sinceMinutes?: number }, signal?: AbortSignal) =>
      request<FetchCodesResult>('/api/mail/fetch', { method: 'POST', body: payload, signal }),
  },

  codes: {
    list: (params: { limit?: number; accountId?: string } = {}) => {
      const search = new URLSearchParams();
      if (params.limit) search.set('limit', String(params.limit));
      if (params.accountId) search.set('accountId', params.accountId);
      const query = search.toString();
      return request<{ codes: CodeRecord[] }>(`/api/codes${query ? `?${query}` : ''}`);
    },
    clear: (accountId?: string) =>
      request<{ removed: number }>(`/api/codes${accountId ? `?accountId=${encodeURIComponent(accountId)}` : ''}`, {
        method: 'DELETE',
      }),
  },

  credentials: {
    generate: (payload: GenerateCredentialsPayload) =>
      request<GenerateCredentialsResult>('/api/credentials/generate', { method: 'POST', body: payload }),
    list: (limit = 50) => request<{ credentials: PublicCredentialRecord[] }>(`/api/credentials?limit=${limit}`),
    remove: (id: string) =>
      request<{ id: string }>(`/api/credentials/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    clear: () => request<{ removed: number }>('/api/credentials', { method: 'DELETE' }),
  },

  system: {
    /**
     * 在系统文件管理器中打开数据目录，返回其绝对路径。
     * 路径由后端唯一决定（`config.dataDir`），前端不自行拼接。
     */
    revealDataDir: (dryRun = false) =>
      request<DataDirInfo>('/api/system/reveal-data-dir', { method: 'POST', body: { dryRun } }),
  },
};
