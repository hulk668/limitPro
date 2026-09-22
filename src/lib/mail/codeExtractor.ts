/**
 * 验证码提取器 —— 项目核心算法（纯函数、零依赖，便于单元测试）。
 *
 * 提取策略（多信号打分，而非"取第一个数字"）：
 *   1. 关键字命中：中英文「验证码 / verification code / OTP / passcode」等，
 *      不同关键字的权重不同（越具体权重越高）
 *   2. 邻近度：候选码与关键字的字符距离越近，得分越高
 *   3. 位置加成：出现在主题中、或紧跟在关键字之后，得分显著提高
 *   4. 长度适配：6 位 > 5 位 > 4 位 > 7/8 位（同时支持 4~8 位纯数字与字母数字混合码）
 *   5. 噪声惩罚：年份、纯重复数字、订单号/金额/快递单号等上下文一律降权
 *   6. 兜底：无任何关键字时，退化为"全文高频 4~8 位数字"，并给出低置信度
 *
 * 分隔符容错：`123 456` / `123-456` / `123_456` 会被识别为同一个 6 位验证码。
 */

export type CodeCandidate = {
  /** 提取出的验证码（已去除分隔符） */
  code: string;
  /** 置信度 0~1 */
  confidence: number;
  /** 判定依据（便于人工复核） */
  reason: string;
  /** 命中位置附近的上下文片段 */
  context: string;
  length: number;
};

export type ExtractInput = {
  subject?: string | null;
  text?: string | null;
  html?: string | null;
  from?: string | null;
};

export type ExtractOptions = {
  /** 最多返回几个候选，默认 5 */
  maxCandidates?: number;
  minLength?: number;
  maxLength?: number;
};

type SourceText = {
  subject: string;
  full: string;
  squashed: string;
};

type KeywordRule = {
  pattern: RegExp;
  weight: number;
  label: string;
};

const DEFAULT_MIN_LENGTH = 4;
const DEFAULT_MAX_LENGTH = 8;
const SERIALIZED_DEFAULT_MAX = 5;

/** 关键字规则：权重越接近 1，说明该关键字越"专指验证码" */
const KEYWORD_RULES: KeywordRule[] = [
  {
    pattern: /(您的|本次|此次|以下|动态)?(短信)?验证码(为|是|如下|：|:)?/g,
    weight: 1.0,
    label: '中文「验证码」',
  },
  { pattern: /(校验码|校验码为|确认码|动态密码|动态码|一次性密码|安全码)/g, weight: 0.92, label: '中文近义关键字' },
  {
    pattern: /(?:verification|confirmation|security|authentication|one[\s-]?time|verify)\s*(?:code|pin|number|password|token)?/gi,
    weight: 0.95,
    label: '英文验证码关键字',
  },
  { pattern: /\b(?:otp|passcode|authcode|auth\s*code)\b/gi, weight: 0.9, label: 'OTP 关键字' },
  { pattern: /\b(?:code|pin)\b/gi, weight: 0.5, label: '通用 code 关键字' },
];

/** 明确属于"非验证码"的噪声上下文 */
const NOISE_CONTEXT_RE =
  /(订单|单号|运单|快递|物流|发票|税号|金额|价格|合计|总额|余额|积分|数量|规格|邮编|电话|手机号|身份证|order\s*(?:no|id|number)|invoice|tracking|amount|total|price|balance|quantity|qty|zip|postal)/i;

/** 货币/单位上下文 */
const CURRENCY_CONTEXT_RE = /[¥￥$€£]|(?:\bRMB\b|\bUSD\b|\bCNY\b|\bEUR\b)|(元|美元|人民币)/;

const YEAR_MIN = 1900;
const YEAR_MAX = 2099;

/* -------------------------------------------------------------------------- */
/* 文本预处理                                                                  */
/* -------------------------------------------------------------------------- */

const HTML_ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&emsp;': ' ',
  '&ensp;': ' ',
};

/** HTML 转纯文本（去掉脚本/样式、保留换行、还原常见实体） */
export function htmlToText(html: string): string {
  if (!html) return '';
  let output = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  output = output.replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)));
  output = output.replace(/&#x([0-9a-f]+);/gi, (_match, code: string) =>
    String.fromCodePoint(Number.parseInt(code, 16)),
  );
  output = output.replace(/&[a-z]+;/gi, (entity) => HTML_ENTITIES[entity.toLowerCase()] ?? ' ');

  return output.replace(/[ \t\u00a0]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * 合并被空格/连字符/下划线分隔的数字组：
 * `123 456` -> `123456`，`123-456` -> `123456`
 */
function squashDigitGroups(text: string): string {
  return text
    .replace(/(?<=\d)[ \t\-_](?=\d)/g, '')
    .replace(/(?<=\d)[ \t\-_](?=\d)/g, '');
}

function buildSource(input: ExtractInput): SourceText {
  const subject = (input.subject ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
  const plain = (input.text ?? '').trim();
  const body = plain.length > 0 ? plain : htmlToText(input.html ?? '');
  const full = [subject, body].filter(Boolean).join('\n');
  return { subject, full, squashed: squashDigitGroups(full) };
}

/* -------------------------------------------------------------------------- */
/* 噪声判定                                                                    */
/* -------------------------------------------------------------------------- */

function isYearLike(token: string): boolean {
  if (token.length !== 4 || !/^\d+$/.test(token)) return false;
  const value = Number(token);
  return value >= YEAR_MIN && value <= YEAR_MAX;
}

function isRepeatedDigits(token: string): boolean {
  return /^(\d)\1+$/.test(token);
}

function isSequential(token: string): boolean {
  if (token.length < 4) return false;
  let ascending = true;
  let descending = true;
  for (let index = 1; index < token.length; index += 1) {
    const delta = token.charCodeAt(index) - token.charCodeAt(index - 1);
    if (delta !== 1) ascending = false;
    if (delta !== -1) descending = false;
  }
  return ascending || descending;
}

/* -------------------------------------------------------------------------- */
/* 候选提取                                                                    */
/* -------------------------------------------------------------------------- */

type RawCandidate = {
  code: string;
  score: number;
  reasons: string[];
  context: string;
  distance: number;
};

function extractContext(text: string, start: number, end: number, radius = 42): string {
  const from = Math.max(0, start - radius);
  const to = Math.min(text.length, end + radius);
  return text
    .slice(from, to)
    .replace(/\s+/g, ' ')
    .trim();
}

/** 在给定窗口内找出所有可能的验证码 token */
function collectTokens(window: string, min: number, max: number): { token: string; offset: number }[] {
  const results: { token: string; offset: number }[] = [];
  // 纯数字
  const numeric = new RegExp(`\\b\\d{${min},${max}}\\b(?!\\.\\d)`, 'g');
  for (const match of window.matchAll(numeric)) {
    results.push({ token: match[0], offset: match.index ?? 0 });
  }
  // 字母数字混合（至少含一个数字与一个字母）
  const mixed = new RegExp(
    `(?<![A-Za-z0-9])(?=[A-Za-z0-9]{${min},${max}}(?![A-Za-z0-9]))(?=[A-Za-z0-9]*\\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{${min},${max}}`,
    'g',
  );
  for (const match of window.matchAll(mixed)) {
    if (!/^\d+$/.test(match[0])) {
      results.push({ token: match[0], offset: match.index ?? 0 });
    }
  }
  return results;
}

function lengthBonus(token: string): number {
  if (/^\d+$/.test(token)) {
    switch (token.length) {
      case 6:
        return 0.1;
      case 5:
        return 0.08;
      case 4:
        return 0.07;
      case 7:
        return 0.05;
      default:
        return 0.03;
    }
  }
  return token.length >= 6 ? 0.06 : 0.04;
}

/** 主提取函数 */
export function extractVerificationCodes(input: ExtractInput, options: ExtractOptions = {}): CodeCandidate[] {
  const minLength = options.minLength ?? DEFAULT_MIN_LENGTH;
  const maxLength = options.maxLength ?? DEFAULT_MAX_LENGTH;
  const maxCandidates = options.maxCandidates ?? SERIALIZED_DEFAULT_MAX;

  const source = buildSource(input);
  if (!source.full.trim()) return [];

  /** code -> 候选聚合 */
  const aggregated = new Map<string, RawCandidate>();
  /** code -> 出现次数 */
  const occurrences = new Map<string, number>();

  const mergeCandidate = (candidate: RawCandidate): void => {
    occurrences.set(candidate.code, (occurrences.get(candidate.code) ?? 0) + 1);
    const existing = aggregated.get(candidate.code);
    if (!existing) {
      aggregated.set(candidate.code, candidate);
      return;
    }
    if (candidate.score > existing.score) {
      aggregated.set(candidate.code, {
        ...candidate,
        reasons: [...new Set([...existing.reasons, ...candidate.reasons])],
      });
    } else {
      existing.reasons = [...new Set([...existing.reasons, ...candidate.reasons])];
      existing.score = Math.max(existing.score, candidate.score);
    }
  };

  // 全文（含分隔符合并变体）双通道扫描，捞回被空格/连字符拆开的验证码
  const channels: { text: string; squashed: boolean }[] = [
    { text: source.full, squashed: false },
    { text: source.squashed, squashed: true },
  ];

  for (const channel of channels) {
    for (const rule of KEYWORD_RULES) {
      for (const match of channel.text.matchAll(rule.pattern)) {
        const keywordIndex = match.index ?? 0;
        const keywordEnd = keywordIndex + match[0].length;
        const windowStart = Math.max(0, keywordIndex - 70);
        const windowEnd = Math.min(channel.text.length, keywordEnd + 90);
        const window = channel.text.slice(windowStart, windowEnd);

        for (const token of collectTokens(window, minLength, maxLength)) {
          const absoluteStart = windowStart + token.offset;
          const absoluteEnd = absoluteStart + token.token.length;

          if (isYearLike(token.token)) continue;
          if (isRepeatedDigits(token.token)) continue;

          const before = channel.text.slice(Math.max(0, absoluteStart - 14), absoluteStart);
          const after = channel.text.slice(absoluteEnd, absoluteEnd + 14);
          const around = channel.text.slice(Math.max(0, absoluteStart - 60), Math.min(channel.text.length, absoluteEnd + 60));

          const distance = token.offset < keywordIndex - windowStart
            ? keywordIndex - windowStart - (token.offset + token.token.length)
            : token.offset - (keywordEnd - windowStart);
          const safeDistance = Math.max(0, distance);

          let score = rule.weight * 0.4;
          score += 0.2 * Math.max(0, 1 - safeDistance / 70);
          score += lengthBonus(token.token);

          const reasons: string[] = [`命中${rule.label}`];
          if (safeDistance <= 6) {
            score += 0.08;
            reasons.push('紧邻关键字');
          }
          if (source.subject.includes(token.token)) {
            score += 0.12;
            reasons.push('出现在邮件主题');
          }
          if (channel.squashed) {
            reasons.push('数字以空格/连字符分隔');
          }
          if (isSequential(token.token)) {
            score -= 0.15;
            reasons.push('疑似连续数字(降权)');
          }
          if (NOISE_CONTEXT_RE.test(around)) {
            score -= 0.3;
            reasons.push('邻近含订单/金额等噪声词(降权)');
          }
          if (CURRENCY_CONTEXT_RE.test(before) || CURRENCY_CONTEXT_RE.test(after)) {
            score -= 0.2;
            reasons.push('疑似金额(降权)');
          }
          if (/[A-Za-z]/.test(token.token)) {
            score -= 0.05;
          }

          mergeCandidate({
            code: token.token,
            score,
            reasons,
            context: extractContext(channel.text, absoluteStart, absoluteEnd),
            distance: safeDistance,
          });
        }
      }
    }
  }

  // 出现次数加成
  for (const candidate of aggregated.values()) {
    const times = occurrences.get(candidate.code) ?? 1;
    if (times > 1) {
      candidate.score += Math.min(0.08, 0.04 * (times - 1));
      candidate.reasons.push(`邮件中出现 ${times} 次`);
    }
  }

  const ranked = [...aggregated.values()]
    .map<CodeCandidate>((candidate) => ({
      code: candidate.code,
      confidence: clamp(candidate.score, 0.05, 0.99),
      reason: [...new Set(candidate.reasons)].join('；'),
      context: candidate.context,
      length: candidate.code.length,
    }))
    .sort((a, b) => b.confidence - a.confidence || b.length - a.length);

  if (ranked.length > 0) {
    return ranked.slice(0, maxCandidates);
  }

  return fallbackExtract(source, { minLength, maxLength, maxCandidates });
}

/**
 * 兜底：完全没有关键字时，取全文出现频次最高的 4~8 位数字。
 * 置信度被刻意压低（<=0.35），提示使用者人工确认。
 */
function fallbackExtract(
  source: SourceText,
  options: { minLength: number; maxLength: number; maxCandidates: number },
): CodeCandidate[] {
  const counter = new Map<string, { count: number; context: string }>();
  const pattern = new RegExp(`\\b\\d{${options.minLength},${options.maxLength}}\\b(?!\\.\\d)`, 'g');

  for (const match of source.full.matchAll(pattern)) {
    const token = match[0];
    if (isYearLike(token) || isRepeatedDigits(token)) continue;
    const index = match.index ?? 0;
    const existing = counter.get(token);
    if (existing) existing.count += 1;
    else counter.set(token, { count: 1, context: formatContext(source.full, index, token.length) });
  }

  const ranked = [...counter.entries()]
    .sort((a, b) => b[1].count - a[1].count || b[0].length - a[0].length)
    .slice(0, options.maxCandidates)
    .map<CodeCandidate>(([code, info], index) => ({
      code,
      confidence: clamp(0.35 - index * 0.05 + Math.min(0.05, info.count * 0.02), 0.05, 0.4),
      reason: '未命中验证码关键字，按出现频次兜底（建议人工确认）',
      context: info.context,
      length: code.length,
    }));

  return ranked;
}

function formatContext(text: string, start: number, length: number, radius = 30): string {
  const from = Math.max(0, start - radius);
  const to = Math.min(text.length, start + length + radius);
  return text.slice(from, to).replace(/\s+/g, ' ').trim();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 便捷方法：取置信度最高的验证码 */
export function pickBestCode(candidates: CodeCandidate[]): CodeCandidate | null {
  return candidates.length > 0 ? candidates[0] : null;
}
