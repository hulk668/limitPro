/**
 * 领域模型 —— 全应用共享的类型定义（后端与前端通用）。
 */

/** ---------------------------------- 邮箱账号 --------------------------------- */

export type AccountStatus = 'unknown' | 'ok' | 'error';

/** 落盘的邮箱账号（密码为 AES-256-GCM 密文） */
export type MailAccount = {
  id: string;
  /** 用户自定义备注名，便于区分多个主邮箱 */
  label: string;
  /** 主邮箱完整地址，同时作为 IMAP 登录名（2925 要求必须用主邮箱登录） */
  email: string;
  imapHost: string;
  imapPort: number;
  /** true=SSL/TLS(993)  false=明文(143) */
  secure: boolean;
  passwordEnc: string;
  createdAt: string;
  updatedAt: string;
  lastCheckedAt: string | null;
  lastStatus: AccountStatus;
  lastError: string | null;
};

/** 对外返回的账号信息（剔除密文） */
export type PublicMailAccount = Omit<MailAccount, 'passwordEnc'>;

export type MailAccountCreateInput = {
  label: string;
  email: string;
  password: string;
  imapHost?: string;
  imapPort?: number;
  secure?: boolean;
};

/** ---------------------------------- 验证码 ---------------------------------- */

export type CodeRecord = {
  id: string;
  accountId: string;
  accountEmail: string;
  code: string;
  /** 0~1 置信度 */
  confidence: number;
  /** 命中的判定依据，便于人工复核 */
  reason: string;
  /** 验证码附近的上下文片段 */
  context: string;
  subject: string;
  from: string;
  /** 邮件到达时间（ISO） */
  receivedAt: string;
  messageId: string;
  createdAt: string;
};

/** --------------------------------- 生成凭据 --------------------------------- */

export type PasswordStrength = {
  /** 0~100 */
  score: number;
  label: '弱' | '一般' | '强' | '极强';
  entropyBits: number;
};

export type CredentialRecord = {
  id: string;
  batchId: string;
  username: string;
  /** 完整邮箱地址（username + 分隔符 + 域名） */
  email: string;
  passwordEnc: string;
  strength: PasswordStrength;
  createdAt: string;
};

/** 接口返回时密码会解密后一并返回（仅本地 127.0.0.1 可访问） */
export type PublicCredentialRecord = Omit<CredentialRecord, 'passwordEnc'> & {
  password: string;
};

/** --------------------------------- 通用响应 --------------------------------- */

export type ApiSuccess<T> = {
  ok: true;
  data: T;
  requestId: string;
};

export type ApiFailure = {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId: string;
};
