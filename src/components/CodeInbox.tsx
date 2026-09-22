'use client';

import {
  CodeText,
  CopyButton,
  EmptyHint,
  LoadingButton,
  SectionCard,
  StatusBadge,
  ToneAlert,
  confidenceTone,
  connectionTone,
  formatDateTime,
  relativeTime,
} from '@/components/shared';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  api,
  describeApiError,
  type CodeRecord,
  type FetchCodesResult,
  type MetaInfo,
  type PublicMailAccount,
} from '@/lib/client/api';
import { notify } from '@/lib/notify';
import { InboxIcon, RefreshCwIcon, RadarIcon, SearchXIcon, SparklesIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

type Props = {
  accounts: PublicMailAccount[];
  accountsLoading: boolean;
  meta: MetaInfo | null;
  onGoToAccounts: () => void;
};

const LIMIT_OPTIONS = [5, 10, 20, 30, 50, 100];
const WINDOW_OPTIONS = [5, 15, 30, 60, 180, 720, 1440];
const POLL_OPTIONS = [3, 5, 8, 15, 30];

function windowLabel(minutes: number): string {
  return minutes >= 60 ? `${minutes / 60} 小时` : `${minutes} 分钟`;
}

export function CodeInbox({ accounts, accountsLoading, meta, onGoToAccounts }: Props) {
  const [accountId, setAccountId] = useState('');
  const [limit, setLimit] = useState(20);
  const [sinceMinutes, setSinceMinutes] = useState(60);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<FetchCodesResult | null>(null);
  const [history, setHistory] = useState<CodeRecord[]>([]);
  const [autoPoll, setAutoPoll] = useState(false);
  const [stopOnFound, setStopOnFound] = useState(true);
  // 默认值必须落在 POLL_OPTIONS 内，否则下拉框会显示为空
  const [pollSeconds, setPollSeconds] = useState(5);

  /* ------------------------------ 账号默认值 ------------------------------ */
  useEffect(() => {
    if (accounts.length === 0) {
      setAccountId('');
      return;
    }
    if (!accounts.some((account) => account.id === accountId)) {
      const preferred = accounts.find((account) => account.lastStatus === 'ok') ?? accounts[0];
      setAccountId(preferred ? preferred.id : '');
    }
  }, [accounts, accountId]);

  useEffect(() => {
    if (meta) {
      setLimit((current) => (current > meta.mail.maxFetchLimit ? meta.mail.fetchLimit : current));
      setSinceMinutes(meta.mail.defaultSinceMinutes);
    }
  }, [meta]);

  /* -------------------------------- 历史 --------------------------------- */
  const loadHistory = useCallback(async () => {
    try {
      const data = await api.codes.list({ limit: 30, accountId: accountId || undefined });
      setHistory(data.codes);
    } catch (error) {
      notify(describeApiError(error), 'err');
    }
  }, [accountId]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  /* ------------------------------- 单次拉取 ------------------------------ */
  const fetchOnce = useCallback(
    async (silent = false): Promise<FetchCodesResult | null> => {
      if (!accountId) {
        if (!silent) notify('请先添加并选择 2925 邮箱账号', 'warn');
        return null;
      }
      if (!silent) setLoading(true);
      try {
        const data = await api.mail.fetchCodes({ accountId, limit, sinceMinutes });
        setResult(data);
        void loadHistory();
        if (!silent) {
          if (data.best) notify(`已捕获验证码 ${data.best.code}`, 'ok');
          else notify(`拉取到 ${data.fetchedCount} 封邮件，未发现验证码`, 'warn');
        }
        return data;
      } catch (error) {
        notify(describeApiError(error), 'err');
        return null;
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [accountId, limit, sinceMinutes, loadHistory],
  );

  /* ------------------------------- 自动轮询 ------------------------------ */
  useEffect(() => {
    if (!autoPoll || !accountId) return;
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      try {
        const data = await api.mail.fetchCodes({ accountId, limit, sinceMinutes });
        if (cancelled) return;
        setResult(data);
        void loadHistory();
        if (data.best && data.best.confidence >= 0.6 && stopOnFound) {
          setAutoPoll(false);
          notify(`已捕获验证码 ${data.best.code}`, 'ok');
        }
      } catch (error) {
        if (cancelled) return;
        setAutoPoll(false);
        notify(describeApiError(error), 'err');
      }
    };

    void tick();
    const timer = setInterval(() => void tick(), Math.max(pollSeconds, 3) * 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [autoPoll, accountId, limit, sinceMinutes, stopOnFound, pollSeconds, loadHistory]);

  const selectedAccount = accounts.find((account) => account.id === accountId) ?? null;
  const best = result?.best ?? null;

  /* --------------------------------- 渲染 -------------------------------- */

  if (!accountsLoading && accounts.length === 0) {
    return (
      <SectionCard title="验证码收件箱" description="尚未配置邮箱账号">
        <ToneAlert tone="info" className="mb-4">
          使用前需要先添加一个 2925 邮箱账号：<span className="font-semibold">登录名填主邮箱完整地址</span>
          ，密码填主邮箱密码（子邮箱 / 别名无法登录客户端）。
        </ToneAlert>
        <EmptyHint
          icon={InboxIcon}
          title="还没有可用的邮箱账号"
          description="添加账号后即可自动拉取邮件并精准提取其中的验证码。"
          action={
            <Button onClick={onGoToAccounts}>
              <SparklesIcon />
              去添加邮箱账号
            </Button>
          }
        />
      </SectionCard>
    );
  }

  return (
    <>
      <SectionCard
        title={
          <span className="flex items-center gap-2">
            <InboxIcon className="size-4 text-muted-foreground" />
            验证码收件箱
          </span>
        }
        description="连接 IMAP 拉取最近邮件，并按「关键字 + 邻近度 + 上下文」多信号打分提取验证码"
        actions={
          <>
            <Button size="xs" variant="outline" onClick={() => void loadHistory()}>
              <RefreshCwIcon />
              刷新历史
            </Button>
            <LoadingButton size="xs" loading={loading} disabled={autoPoll} onClick={() => void fetchOnce()}>
              <RadarIcon />
              {loading ? '拉取中…' : '立即拉取'}
            </LoadingButton>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field>
            <FieldLabel htmlFor="inbox-account">邮箱账号</FieldLabel>
            <Select value={accountId} onValueChange={setAccountId} disabled={autoPoll}>
              <SelectTrigger id="inbox-account" className="w-full">
                <SelectValue placeholder="请选择账号" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.label} · {account.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel htmlFor="inbox-limit">拉取邮件数</FieldLabel>
            <Select
              value={String(limit)}
              onValueChange={(value) => setLimit(Number(value))}
              disabled={autoPoll}
            >
              <SelectTrigger id="inbox-limit" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LIMIT_OPTIONS.filter((value) => value <= (meta?.mail.maxFetchLimit ?? 100)).map((value) => (
                  <SelectItem key={value} value={String(value)}>
                    {value} 封
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel htmlFor="inbox-window">时间窗口</FieldLabel>
            <Select
              value={String(sinceMinutes)}
              onValueChange={(value) => setSinceMinutes(Number(value))}
              disabled={autoPoll}
            >
              <SelectTrigger id="inbox-window" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WINDOW_OPTIONS.map((value) => (
                  <SelectItem key={value} value={String(value)}>
                    {windowLabel(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel htmlFor="inbox-poll">轮询间隔</FieldLabel>
            <Select
              value={String(pollSeconds)}
              onValueChange={(value) => setPollSeconds(Number(value))}
              disabled={autoPoll}
            >
              <SelectTrigger id="inbox-poll" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {POLL_OPTIONS.map((value) => (
                  <SelectItem key={value} value={String(value)}>
                    {value} 秒
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <Separator className="my-4" />

        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <div className="flex items-center gap-2">
            <Switch
              id="inbox-autopoll"
              checked={autoPoll}
              onCheckedChange={(value) => {
                if (value && !accountId) {
                  notify('请先选择邮箱账号', 'warn');
                  return;
                }
                setAutoPoll(value);
                if (value) notify('已开启自动轮询，正在等待验证码…', 'ok');
              }}
            />
            <Label htmlFor="inbox-autopoll" className="text-xs font-normal text-muted-foreground">
              {autoPoll ? '自动轮询中…' : '开启自动轮询'}
            </Label>
          </div>

          <div className="flex items-center gap-2">
            <Switch id="inbox-stop" checked={stopOnFound} onCheckedChange={setStopOnFound} />
            <Label htmlFor="inbox-stop" className="text-xs font-normal text-muted-foreground">
              命中后自动停止
            </Label>
          </div>

          {selectedAccount ? (
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              当前账号：
              <StatusBadge tone={connectionTone(selectedAccount.lastStatus)}>
                {selectedAccount.lastStatus === 'ok'
                  ? '连接正常'
                  : selectedAccount.lastStatus === 'error'
                    ? '连接异常'
                    : '未检测'}
              </StatusBadge>
              {selectedAccount.lastCheckedAt ? <span>（{relativeTime(selectedAccount.lastCheckedAt)}检测）</span> : null}
            </span>
          ) : null}
        </div>

        {selectedAccount?.lastStatus === 'error' && selectedAccount.lastError ? (
          <ToneAlert tone="danger" className="mt-4">
            {selectedAccount.lastError}
          </ToneAlert>
        ) : null}

        {meta?.mail.disableServerSearch ? (
          <ToneAlert tone="info" className="mt-4">
            2925 邮箱的 IMAP 服务<span className="font-semibold">不支持 SEARCH 命令</span>
            ，因此本工具采用「取邮件总数 → 按序号 FETCH → 本地按时间过滤」的方式拉取，这不会影响验证码提取结果。
          </ToneAlert>
        ) : null}

        {best ? (
          <div className="mt-4 flex flex-wrap items-center gap-5 rounded-lg border border-info/30 bg-gradient-to-br from-info/10 to-chart-4/10 p-4">
            <div className="font-mono text-3xl font-bold tracking-[0.18em]">{best.code}</div>
            <div className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <StatusBadge tone={confidenceTone(best.confidence)}>
                  置信度 {(best.confidence * 100).toFixed(0)}%
                </StatusBadge>
                <span>{best.length} 位</span>
              </div>
              <span className="truncate text-foreground">{best.subject || '（无主题）'}</span>
              <span>
                {best.from} · {formatDateTime(best.receivedAt)}
              </span>
              <span>{best.reason}</span>
            </div>
            <div className="ml-auto">
              <CopyButton value={best.code} label="复制验证码" size="default" variant="default" />
            </div>
          </div>
        ) : result ? (
          <ToneAlert tone="warn" className="mt-4">
            拉取到 {result.fetchedCount} 封邮件（{result.windowMinutes} 分钟窗口），但未发现置信度较高的验证码。
            可适当放宽时间窗口或增大拉取数量后重试。
          </ToneAlert>
        ) : null}
      </SectionCard>

      {result && result.messages.length > 0 ? (
        <SectionCard
          title={
            <span className="flex items-center gap-2">
              <InboxIcon className="size-4 text-muted-foreground" />
              邮件明细
            </span>
          }
          description={`共 ${result.messages.length} 封，展示每封邮件的候选验证码`}
        >
          <div className="flex flex-col gap-3">
            {result.messages.map((message) => (
              <div key={message.uid} className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-sm font-medium" title={message.subject}>
                    {message.subject || '（无主题）'}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {message.from} · {formatDateTime(message.receivedAt)}
                  </span>
                </div>

                {message.candidates.length > 0 ? (
                  <div className="flex flex-col gap-1.5">
                    {message.candidates.slice(0, 3).map((candidate) => (
                      <div
                        key={`${message.uid}-${candidate.code}`}
                        className="flex items-center justify-between gap-3 rounded-md border bg-card px-2.5 py-1.5"
                      >
                        <div className="flex min-w-0 items-center gap-2.5">
                          <CodeText className="text-sm font-semibold">{candidate.code}</CodeText>
                          <StatusBadge tone={confidenceTone(candidate.confidence)}>
                            {(candidate.confidence * 100).toFixed(0)}%
                          </StatusBadge>
                          <span className="truncate text-xs text-muted-foreground">{candidate.reason}</span>
                        </div>
                        <CopyButton value={candidate.code} />
                      </div>
                    ))}
                    <div className="rounded-md bg-background/60 px-2 py-1.5 font-mono text-xs break-all text-muted-foreground">
                      {message.candidates[0]?.context}
                    </div>
                  </div>
                ) : (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <SearchXIcon className="size-3.5" />
                    未在该邮件中识别出验证码
                  </span>
                )}
              </div>
            ))}
          </div>
        </SectionCard>
      ) : null}

      <SectionCard
        title={
          <span className="flex items-center gap-2">
            <InboxIcon className="size-4 text-muted-foreground" />
            提取历史
          </span>
        }
        description={`最近 ${history.length} 条（按邮件到达时间倒序，已按「邮件ID + 验证码」去重）`}
      >
        {history.length === 0 ? (
          <EmptyHint
            icon={InboxIcon}
            title="暂无提取记录"
            description="点击「立即拉取」或开启自动轮询后，命中的验证码会自动记录在这里。"
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">验证码</TableHead>
                <TableHead className="w-24">置信度</TableHead>
                <TableHead>来源邮件</TableHead>
                <TableHead className="w-36">到达时间</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((record) => (
                <TableRow key={record.id}>
                  <TableCell>
                    <CodeText className="text-sm font-semibold">{record.code}</CodeText>
                  </TableCell>
                  <TableCell>
                    <StatusBadge tone={confidenceTone(record.confidence)}>
                      {(record.confidence * 100).toFixed(0)}%
                    </StatusBadge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <span className="max-w-[420px] truncate">{record.subject || '（无主题）'}</span>
                      <span className="text-xs text-muted-foreground">
                        {record.from} · {record.accountEmail}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                    {formatDateTime(record.receivedAt)}
                  </TableCell>
                  <TableCell>
                    <CopyButton value={record.code} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>
    </>
  );
}
