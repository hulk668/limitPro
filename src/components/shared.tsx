'use client';

/**
 * 业务共享组件 —— 全部基于 shadcn/ui 原语封装。
 * 目的：把「状态徽标 / 提示条 / 复制按钮 / 区块卡片」这类在多个页面重复出现的
 * 组合收敛到一处，页面只描述业务，不重复拼装样式。
 */
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import {
  CheckIcon,
  CircleAlertIcon,
  CopyIcon,
  InboxIcon,
  InfoIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';

/* -------------------------------- 剪贴板 --------------------------------- */

/** 复制文本到剪贴板；现代 API 不可用时降级到 execCommand */
export async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 降级到 execCommand */
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const succeeded = document.execCommand('copy');
    document.body.removeChild(area);
    return succeeded;
  } catch {
    return false;
  }
}

/* -------------------------------- 区块卡片 -------------------------------- */

/** 带标题栏的内容卡片（Card + CardHeader + CardAction 组合） */
export function SectionCard({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <Card className={cn('gap-0 overflow-hidden py-0', className)}>
      <CardHeader className="gap-1 border-b bg-muted/40 px-4 py-3">
        <CardTitle className="text-sm">{title}</CardTitle>
        {description ? <CardDescription className="text-xs">{description}</CardDescription> : null}
        {actions ? <CardAction className="flex flex-wrap items-center gap-2">{actions}</CardAction> : null}
      </CardHeader>
      <CardContent className={cn('px-4 py-4', bodyClassName)}>{children}</CardContent>
    </Card>
  );
}

/* --------------------------------- 徽标 ---------------------------------- */

export type StatusTone = 'ok' | 'err' | 'warn' | 'muted' | 'info';

const STATUS_TONE_CLASS: Record<StatusTone, string> = {
  ok: 'border-success/40 bg-success/10 text-success',
  err: 'border-destructive/40 bg-destructive/10 text-destructive',
  warn: 'border-warning/40 bg-warning/10 text-warning',
  muted: 'border-border bg-muted text-muted-foreground',
  info: 'border-info/40 bg-info/10 text-info',
};

/** 语义化状态徽标（替代原先自定义的 badge-xxx 类） */
export function StatusBadge({
  tone = 'muted',
  className,
  children,
}: {
  tone?: StatusTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Badge className={cn(STATUS_TONE_CLASS[tone], className)}>
      {children}
    </Badge>
  );
}

/* -------------------------------- 提示条 --------------------------------- */

const ALERT_TONES: Record<'info' | 'warn' | 'danger', { icon: LucideIcon; className: string }> = {
  info: { icon: InfoIcon, className: 'border-info/40 bg-info/10 text-info' },
  warn: { icon: TriangleAlertIcon, className: 'border-warning/40 bg-warning/10 text-warning' },
  danger: { icon: CircleAlertIcon, className: 'border-destructive/40 bg-destructive/10 text-destructive' },
};

/** 三态提示条（info / warn / danger），文案可含富文本 */
export function ToneAlert({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: 'info' | 'warn' | 'danger';
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const { icon: Icon, className: toneClass } = ALERT_TONES[tone];
  return (
    <Alert className={cn('items-start gap-x-3', toneClass, className)}>
      <Icon />
      {title ? <AlertTitle className="text-current">{title}</AlertTitle> : null}
      {/*
        注意：AlertDescription 默认是 grid 布局，行内元素会被当成独立网格项拆行。
        这里显式改成 block，让内部的行内文本与 <span> 正常连排。
      */}
      <AlertDescription className="block text-current/85 leading-relaxed">{children}</AlertDescription>
    </Alert>
  );
}

/* -------------------------------- 按钮 ----------------------------------- */

/** Button 的包装：自动处理 loading 态与禁用 */
export function LoadingButton({
  loading,
  children,
  disabled,
  ...rest
}: ComponentProps<typeof Button> & { loading?: boolean }) {
  return (
    <Button {...rest} disabled={disabled || loading}>
      {loading ? <Spinner /> : null}
      {children}
    </Button>
  );
}

/** 复制按钮：复制成功后短暂显示「已复制」 */
export function CopyButton({
  value,
  label,
  size,
  variant = 'ghost',
  className,
}: {
  value: string;
  /** 不传则只显示图标 */
  label?: string;
  size?: ComponentProps<typeof Button>['size'];
  variant?: ComponentProps<typeof Button>['variant'];
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const handleCopy = useCallback(async () => {
    const succeeded = await writeClipboard(value);
    setCopied(succeeded);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1400);
  }, [value]);

  return (
    <Button
      type="button"
      size={size ?? (label ? 'xs' : 'icon-xs')}
      variant={variant}
      className={className}
      onClick={() => void handleCopy()}
      title={copied ? '已复制到剪贴板' : '复制到剪贴板'}
    >
      {copied ? <CheckIcon className="text-success" /> : <CopyIcon />}
      {label ? <span>{copied ? '已复制' : label}</span> : null}
    </Button>
  );
}

/* -------------------------------- 空状态 --------------------------------- */

/** 空状态占位（Empty 组件组合） */
export function EmptyHint({
  icon: Icon = InboxIcon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <Empty className={cn('border border-dashed border-border p-6 md:p-8', className)}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle className="text-base">{title}</EmptyTitle>
        {description ? <EmptyDescription>{description}</EmptyDescription> : null}
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  );
}

/* --------------------------------- 文本 ---------------------------------- */

/** 等宽代码化文本（用户名 / 密码 / 验证码 / 接口路径等） */
export function CodeText({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('font-mono text-xs tracking-wide', className)}>{children}</span>;
}

/* --------------------------------- 工具 ---------------------------------- */

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function relativeTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const diffSeconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (diffSeconds < 60) return `${Math.max(diffSeconds, 0)} 秒前`;
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)} 分钟前`;
  if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)} 小时前`;
  return `${Math.floor(diffSeconds / 86400)} 天前`;
}

/** 验证码置信度 → 语义色 */
export function confidenceTone(confidence: number): StatusTone {
  if (confidence >= 0.75) return 'ok';
  if (confidence >= 0.5) return 'warn';
  return 'muted';
}

/** 邮箱连通状态 → 语义色 */
export function connectionTone(status: 'ok' | 'error' | 'unknown' | string): StatusTone {
  if (status === 'ok') return 'ok';
  if (status === 'error') return 'err';
  return 'muted';
}
