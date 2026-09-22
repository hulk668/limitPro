/**
 * 随机账号 / 密码生成器（纯函数，零依赖）。
 * 随机源统一使用 node:crypto 的 CSPRNG（randomInt），不使用 Math.random。
 *
 * 2925 无限邮箱的别名规则使用 `_` 作为分隔符：
 *   主邮箱 mike@2925.com -> 别名 mike_github@2925.com
 * 因此本模块支持传入 prefix + separator 拼装别名地址。
 */
import { randomInt } from 'node:crypto';
import type { PasswordStrength } from '../types';

const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const SYMBOLS = '!@#$%^&*()-_=+[]{}:,.?';
/** 易混淆字符：0/O/o/1/l/I/i/5/S/s */
const AMBIGUOUS_CHARS = '0Oo1lIi5Ss';

const READABLE_ADJECTIVES = [
  'swift', 'brave', 'calm', 'clever', 'cosmic', 'crisp', 'eager', 'fuzzy', 'gentle', 'golden',
  'happy', 'hollow', 'jolly', 'lively', 'lucky', 'mellow', 'mighty', 'noble', 'polar', 'quiet',
  'rapid', 'royal', 'silent', 'solar', 'sunny', 'tiny', 'vivid', 'witty', 'young', 'zesty',
] as const;

const READABLE_NOUNS = [
  'otter', 'panda', 'falcon', 'tiger', 'maple', 'river', 'comet', 'ember', 'cedar', 'lunar',
  'orbit', 'pixel', 'quartz', 'raven', 'sable', 'topaz', 'valley', 'willow', 'yonder', 'zephyr',
  'badger', 'cactus', 'dolphin', 'eagle', 'fjord', 'glacier', 'harbor', 'island', 'jungle', 'kite',
] as const;

export type UsernameStyle = 'random' | 'readable';

export type GenerateOptions = {
  count: number;
  usernameLength: number;
  passwordLength: number;
  uppercase: boolean;
  symbols: boolean;
  digits: boolean;
  excludeAmbiguous: boolean;
  style: UsernameStyle;
  /** 邮箱域名；留空则不生成邮箱 */
  emailDomain: string;
  /** 2925 主邮箱前缀（别名形式：prefix + separator + username@domain） */
  emailPrefix: string;
  /** 别名分隔符，2925 为 `_` */
  aliasSeparator: string;
};

export type GeneratedCredential = {
  username: string;
  email: string;
  password: string;
  strength: PasswordStrength;
};

/** 从数组中随机取一项 */
function pick<T>(list: readonly T[]): T {
  return list[randomInt(0, list.length)] as T;
}

/** 从字符集中随机取一个字符 */
function pickChar(charset: string): string {
  return charset[randomInt(0, charset.length)] as string;
}

function filterAmbiguous(source: string, excludeAmbiguous: boolean): string {
  if (!excludeAmbiguous) return source;
  return [...source].filter((char) => !AMBIGUOUS_CHARS.includes(char)).join('');
}

/** Fisher–Yates 洗牌（使用 CSPRNG） */
function shuffle(chars: string[]): string[] {
  for (let index = chars.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(0, index + 1);
    const temp = chars[index] as string;
    chars[index] = chars[swapIndex] as string;
    chars[swapIndex] = temp;
  }
  return chars;
}

/** 生成用户名：必须以字母开头，且同时包含字母与数字 */
export function generateUsername(options: {
  length: number;
  style: UsernameStyle;
  digits: boolean;
  excludeAmbiguous: boolean;
}): string {
  // 说明：excludeAmbiguous 仅作用于随机字符集与数字后缀。
  // readable 风格使用真实英文单词（如 "lively" / "island"），其中的 l/i/s/o 无法剔除。
  const targetLength = Math.max(6, options.length);
  const letters = filterAmbiguous(LOWERCASE, options.excludeAmbiguous) || LOWERCASE;
  const numbers = filterAmbiguous(DIGITS, options.excludeAmbiguous) || DIGITS;

  if (options.style === 'readable') {
    const adjective = pick(READABLE_ADJECTIVES);
    const noun = pick(READABLE_NOUNS);
    const suffixLength = Math.max(2, Math.min(6, targetLength - adjective.length - noun.length));
    let suffix = '';
    for (let index = 0; index < suffixLength; index += 1) suffix += pickChar(numbers);
    return `${adjective}${noun}${suffix}`;
  }

  const pool = options.digits ? `${letters}${numbers}` : letters;
  const chars: string[] = [pickChar(letters), pickChar(numbers)];

  while (chars.length < targetLength) {
    const isNumberSlot = options.digits && randomInt(0, 4) === 0;
    chars.push(isNumberSlot ? pickChar(numbers) : pickChar(pool));
  }

  // 保证首位为字母（多数网站的用户名规则）
  const shuffled = shuffle(chars);
  if (!/[a-z]/.test(shuffled[0] as string)) {
    const letterIndex = shuffled.findIndex((char) => /[a-z]/.test(char));
    if (letterIndex > 0) {
      const first = shuffled[0] as string;
      shuffled[0] = shuffled[letterIndex] as string;
      shuffled[letterIndex] = first;
    } else {
      shuffled.unshift(pickChar(letters));
      shuffled.pop();
    }
  }
  return shuffled.join('').slice(0, targetLength);
}

/** 生成强随机密码（保证每类已启用字符至少出现一次） */
export function generatePassword(options: {
  length: number;
  uppercase: boolean;
  digits: boolean;
  symbols: boolean;
  excludeAmbiguous: boolean;
}): { password: string; entropyBits: number } {
  const lower = filterAmbiguous(LOWERCASE, options.excludeAmbiguous) || LOWERCASE;
  const upper = filterAmbiguous(UPPERCASE, options.excludeAmbiguous) || UPPERCASE;
  const digits = filterAmbiguous(DIGITS, options.excludeAmbiguous) || DIGITS;
  const symbols = filterAmbiguous(SYMBOLS, options.excludeAmbiguous) || SYMBOLS;

  const pools: string[] = [lower];
  if (options.uppercase) pools.push(upper);
  if (options.digits) pools.push(digits);
  if (options.symbols) pools.push(symbols);

  const all = pools.join('');
  const length = Math.max(pools.length, options.length);

  // 每类字符先各放一个，保证强度下限，再随机填充，最后打乱位置
  const chars: string[] = pools.map((pool) => pickChar(pool));
  while (chars.length < length) chars.push(pickChar(all));

  const password = shuffle(chars).join('').slice(0, length);
  const entropyBits = length * Math.log2(all.length);
  return { password, entropyBits };
}

/** 评估密码强度（基于字符集香农熵） */
export function evaluateStrength(entropyBits: number): PasswordStrength {
  const score = Math.max(0, Math.min(100, Math.round((entropyBits / 128) * 100)));
  let label: PasswordStrength['label'] = '弱';
  if (entropyBits >= 100) label = '极强';
  else if (entropyBits >= 75) label = '强';
  else if (entropyBits >= 50) label = '一般';
  return { score, label, entropyBits: Math.round(entropyBits * 10) / 10 };
}

function buildEmail(username: string, options: GenerateOptions): string {
  const domain = options.emailDomain.trim();
  if (!domain) return '';
  const prefix = options.emailPrefix.trim();
  const separator = options.aliasSeparator || '_';
  const localPart = prefix ? `${prefix}${separator}${username}` : username;
  return `${localPart}@${domain}`;
}

/** 生成一批账号（用户名 + 密码 + 可选的邮箱地址） */
export function generateCredentials(options: GenerateOptions): GeneratedCredential[] {
  const results: GeneratedCredential[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < options.count; index += 1) {
    const makeUsername = () =>
      generateUsername({
        length: options.usernameLength,
        style: options.style,
        digits: options.digits,
        excludeAmbiguous: options.excludeAmbiguous,
      });

    let username = makeUsername();
    // 极小概率重复，重试保证批次内唯一
    let guard = 0;
    while (seen.has(username) && guard < 10) {
      username = makeUsername();
      guard += 1;
    }
    seen.add(username);

    const { password, entropyBits } = generatePassword({
      length: options.passwordLength,
      uppercase: options.uppercase,
      digits: options.digits,
      symbols: options.symbols,
      excludeAmbiguous: options.excludeAmbiguous,
    });

    results.push({
      username,
      email: buildEmail(username, options),
      password,
      strength: evaluateStrength(entropyBits),
    });
  }

  return results;
}
