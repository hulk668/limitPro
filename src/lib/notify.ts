'use client';

import { toast } from 'sonner';

export type NotifyTone = 'ok' | 'err' | 'warn';

/**
 * 全局提示（基于 sonner）。
 * 统一封装成 notify(message, tone) 一种调用形态，组件层无需关心底层实现。
 */
export function notify(message: string, tone: NotifyTone = 'ok'): void {
  const options = { duration: tone === 'err' ? 6000 : 3600 };
  if (tone === 'err') {
    toast.error(message, options);
    return;
  }
  if (tone === 'warn') {
    toast.warning(message, options);
    return;
  }
  toast.success(message, options);
}
