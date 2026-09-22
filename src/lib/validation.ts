/**
 * 边界输入校验 —— 所有外部输入（请求体 / 查询串）必须经过此模块，
 * 绝不信任客户端数据。校验失败时一次性返回全部字段错误。
 */
import { AppError } from './errors';

export type FieldErrors = Record<string, string>;

export type FieldSpec =
  | {
      type: 'string';
      required?: boolean;
      label?: string;
      min?: number;
      max?: number;
      pattern?: RegExp;
      patternMessage?: string;
      default?: string;
      trim?: boolean;
    }
  | { type: 'email'; required?: boolean; label?: string; max?: number; default?: string }
  | {
      type: 'int';
      required?: boolean;
      label?: string;
      min?: number;
      max?: number;
      default?: number;
    }
  | { type: 'boolean'; required?: boolean; label?: string; default?: boolean }
  | {
      type: 'stringArray';
      required?: boolean;
      label?: string;
      min?: number;
      max?: number;
      itemMax?: number;
      default?: string[];
    };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function labelOf(spec: FieldSpec, field: string): string {
  return spec.label ?? field;
}

/** 把任意输入规整为普通对象 */
export function toPlainObject(input: unknown, what = '请求体'): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw AppError.validation(`${what}必须是 JSON 对象`);
  }
  return input as Record<string, unknown>;
}

function coerce(value: unknown): unknown {
  if (typeof value === 'string') return value.trim();
  return value;
}

export function validateObject<T extends Record<string, unknown>>(
  raw: unknown,
  spec: Record<string, FieldSpec>,
  what = '请求体',
): T {
  const source = toPlainObject(raw, what);
  const errors: FieldErrors = {};
  const output: Record<string, unknown> = {};

  for (const [field, fieldSpec] of Object.entries(spec)) {
    const label = labelOf(fieldSpec, field);
    const input = coerce(source[field]);
    const isEmpty = input === undefined || input === null || input === '';

    if (isEmpty) {
      if (fieldSpec.required) {
        errors[field] = `${label}不能为空`;
        continue;
      }
      if (fieldSpec.default !== undefined) output[field] = fieldSpec.default;
      continue;
    }

    switch (fieldSpec.type) {
      case 'string': {
        if (typeof input !== 'string') {
          errors[field] = `${label}必须是字符串`;
          break;
        }
        const text = fieldSpec.trim === false ? String(source[field]) : input.trim();
        if (fieldSpec.min !== undefined && text.length < fieldSpec.min) {
          errors[field] = `${label}长度不得少于 ${fieldSpec.min} 个字符`;
          break;
        }
        if (fieldSpec.max !== undefined && text.length > fieldSpec.max) {
          errors[field] = `${label}长度不得超过 ${fieldSpec.max} 个字符`;
          break;
        }
        if (fieldSpec.pattern && !fieldSpec.pattern.test(text)) {
          errors[field] = fieldSpec.patternMessage ?? `${label}格式不正确`;
          break;
        }
        output[field] = text;
        break;
      }
      case 'email': {
        if (typeof input !== 'string') {
          errors[field] = `${label}必须是字符串`;
          break;
        }
        const text = input.trim();
        if (fieldSpec.max !== undefined && text.length > fieldSpec.max) {
          errors[field] = `${label}长度不得超过 ${fieldSpec.max} 个字符`;
          break;
        }
        if (!EMAIL_RE.test(text)) {
          errors[field] = `${label}不是合法的邮箱地址`;
          break;
        }
        output[field] = text;
        break;
      }
      case 'int': {
        const parsed = typeof input === 'number' ? input : Number.parseInt(String(input), 10);
        if (!Number.isInteger(parsed)) {
          errors[field] = `${label}必须是整数`;
          break;
        }
        if (fieldSpec.min !== undefined && parsed < fieldSpec.min) {
          errors[field] = `${label}不得小于 ${fieldSpec.min}`;
          break;
        }
        if (fieldSpec.max !== undefined && parsed > fieldSpec.max) {
          errors[field] = `${label}不得大于 ${fieldSpec.max}`;
          break;
        }
        output[field] = parsed;
        break;
      }
      case 'boolean': {
        if (typeof input === 'boolean') {
          output[field] = input;
          break;
        }
        const normalized = String(input).toLowerCase();
        if (['1', 'true', 'yes', 'on'].includes(normalized)) {
          output[field] = true;
          break;
        }
        if (['0', 'false', 'no', 'off'].includes(normalized)) {
          output[field] = false;
          break;
        }
        errors[field] = `${label}必须是布尔值`;
        break;
      }
      case 'stringArray': {
        const list = Array.isArray(input) ? input : [input];
        const items: string[] = [];
        for (const item of list) {
          if (typeof item !== 'string' || item.trim() === '') {
            errors[field] = `${label}只能包含非空字符串`;
            break;
          }
          const text = item.trim();
          if (fieldSpec.itemMax !== undefined && text.length > fieldSpec.itemMax) {
            errors[field] = `${label}中单个元素长度不得超过 ${fieldSpec.itemMax}`;
            break;
          }
          items.push(text);
        }
        if (errors[field]) break;
        if (fieldSpec.min !== undefined && items.length < fieldSpec.min) {
          errors[field] = `${label}至少包含 ${fieldSpec.min} 个元素`;
          break;
        }
        if (fieldSpec.max !== undefined && items.length > fieldSpec.max) {
          errors[field] = `${label}最多包含 ${fieldSpec.max} 个元素`;
          break;
        }
        output[field] = items;
        break;
      }
      default: {
        errors[field] = `${label}校验规则未定义`;
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    throw AppError.validation('输入校验未通过', { fields: errors });
  }
  return output as T;
}

/** 把 URLSearchParams 转成普通对象，便于复用 validateObject */
export function searchParamsToObject(params: URLSearchParams): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of params.entries()) {
    if (!(key in output)) output[key] = value;
  }
  return output;
}
