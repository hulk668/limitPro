'use client';

import {
  CodeText,
  CopyButton,
  EmptyHint,
  LoadingButton,
  SectionCard,
  StatusBadge,
  ToneAlert,
  formatDateTime,
  writeClipboard,
  type StatusTone,
} from '@/components/shared';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  type MetaInfo,
  type PublicCredentialRecord,
  type PublicMailAccount,
} from '@/lib/client/api';
import { notify } from '@/lib/notify';
import { DicesIcon, FileSpreadsheetIcon, KeyRoundIcon, Trash2Icon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

type Props = {
  accounts: PublicMailAccount[];
  meta: MetaInfo | null;
};

/** 下拉框里「只生成用户名、不带邮箱」的取值（Radix Select 不接受空字符串值） */
const NO_EMAIL = '__none__';

function strengthTone(label: PublicCredentialRecord['strength']['label']): StatusTone {
  if (label === '极强') return 'info';
  if (label === '强') return 'ok';
  if (label === '一般') return 'warn';
  return 'err';
}

/** 把 a@b 拆成 { prefix: 'a', domain: 'b' } */
function splitEmail(email: string): { prefix: string; domain: string } {
  const at = email.lastIndexOf('@');
  if (at <= 0) return { prefix: email, domain: '' };
  return { prefix: email.slice(0, at), domain: email.slice(at + 1) };
}

export function CredentialGenerator({ accounts, meta }: Props) {
  const [count, setCount] = useState(1);
  const [selectedEmail, setSelectedEmail] = useState(NO_EMAIL);

  const [loading, setLoading] = useState(false);
  const [batch, setBatch] = useState<PublicCredentialRecord[]>([]);
  const [history, setHistory] = useState<PublicCredentialRecord[]>([]);
  const [clearing, setClearing] = useState(false);
  /** 用户是否手动动过邮箱下拉框（动过之后不再自动改选） */
  const [userPicked, setUserPicked] = useState(false);

  // 默认选中「邮箱管理」中的第一个邮箱；账号列表变化时只在必要时修正选择
  useEffect(() => {
    if (userPicked) {
      setSelectedEmail((current) =>
        current !== NO_EMAIL && !accounts.some((item) => item.email === current) ? NO_EMAIL : current,
      );
      return;
    }
    setSelectedEmail(accounts[0]?.email ?? NO_EMAIL);
  }, [accounts, userPicked]);

  useEffect(() => {
    if (!meta) return;
    setCount((current) => Math.min(current, meta.credential.maxBatch));
  }, [meta]);

  const selectedAccount = useMemo(
    () => accounts.find((item) => item.email === selectedEmail) ?? null,
    [accounts, selectedEmail],
  );
  const emailPrefix = selectedAccount ? splitEmail(selectedAccount.email).prefix : '';
  const emailDomain = selectedAccount ? splitEmail(selectedAccount.email).domain : '';
  const aliasSeparator = meta?.credential.defaults.aliasSeparator ?? '_';

  const loadHistory = useCallback(async () => {
    try {
      const data = await api.credentials.list(60);
      setHistory(data.credentials);
    } catch (error) {
      notify(describeApiError(error), 'err');
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const result = await api.credentials.generate({
        count,
        // 长度与用户名风格交给后端随机；大小写/数字/符号/排除混淆字符走默认配置
        randomize: true,
        emailPrefix,
        emailDomain,
        aliasSeparator,
      });
      setBatch(result.credentials);
      notify(`已生成 ${result.count} 组账号密码`, 'ok');
      await loadHistory();
    } catch (error) {
      notify(describeApiError(error), 'err');
    } finally {
      setLoading(false);
    }
  };

  const copyBatchAsCsv = async () => {
    if (batch.length === 0) return;
    const header = 'username,email,password,strength';
    const rows = batch.map((item) =>
      [item.username, item.email, item.password, item.strength.label]
        .map((field) => (field.includes(',') ? `"${field}"` : field))
        .join(','),
    );
    const succeeded = await writeClipboard([header, ...rows].join('\n'));
    notify(succeeded ? '已复制 CSV 到剪贴板' : '复制失败，请手动选择复制', succeeded ? 'ok' : 'err');
  };

  const clearHistory = async () => {
    setClearing(true);
    try {
      const { removed } = await api.credentials.clear();
      notify(`已清空 ${removed} 条生成记录`, 'ok');
      setBatch([]);
      await loadHistory();
    } catch (error) {
      notify(describeApiError(error), 'err');
    } finally {
      setClearing(false);
    }
  };

  const removeOne = async (id: string) => {
    try {
      await api.credentials.remove(id);
      notify('已删除该条记录', 'ok');
      await loadHistory();
    } catch (error) {
      notify(describeApiError(error), 'err');
    }
  };

  const limits = meta?.credential;

  return (
    <>
      <SectionCard
        title={
          <span className="flex items-center gap-2">
            <KeyRoundIcon className="size-4 text-muted-foreground" />
            随机账号 / 密码生成器
          </span>
        }
        description="选好数量和邮箱直接生成即可 —— 用户名与密码的长度、风格每次自动随机，密码默认含大小写、数字与符号并排除易混淆字符"
        actions={
          <LoadingButton loading={loading} onClick={() => void handleGenerate()}>
            {loading ? '生成中…' : `生成 ${count} 组`}
          </LoadingButton>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="credential-count">生成数量</FieldLabel>
            <Input
              id="credential-count"
              value={String(count)}
              inputMode="numeric"
              onChange={(event) => {
                const value = Number(event.target.value.replace(/\D/g, '')) || 1;
                setCount(Math.min(Math.max(value, 1), limits?.maxBatch ?? 50));
              }}
            />
            <FieldDescription>单批上限 {limits?.maxBatch ?? 50} 组</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="credential-email">主邮箱前缀</FieldLabel>
            <Select
              value={selectedEmail}
              disabled={accounts.length === 0}
              onValueChange={(value) => {
                setUserPicked(true);
                setSelectedEmail(value);
              }}
            >
              <SelectTrigger id="credential-email" className="w-full">
                <SelectValue placeholder="（暂无邮箱）" />
              </SelectTrigger>
              <SelectContent>
                {accounts.length === 0 ? (
                  <SelectItem value={NO_EMAIL}>（暂无邮箱）</SelectItem>
                ) : (
                  <>
                    {accounts.map((item) => (
                      <SelectItem key={item.id} value={item.email}>
                        {item.label ? `${item.label} — ${item.email}` : item.email}
                      </SelectItem>
                    ))}
                    <SelectItem value={NO_EMAIL}>仅生成用户名（不带邮箱）</SelectItem>
                  </>
                )}
              </SelectContent>
            </Select>
            <FieldDescription>取自「邮箱管理」中已配置的邮箱</FieldDescription>
          </Field>
        </div>

        {selectedAccount ? (
          <ToneAlert tone="info" className="mt-4">
            邮箱按{' '}
            <CodeText className="font-semibold">{`${emailPrefix}${aliasSeparator}<随机串>@${emailDomain}`}</CodeText>{' '}
            形式生成。2925 的别名邮件会统一投递到主邮箱收件箱，因此在「验证码收件箱」里选中同一个邮箱就能收到所有别名的验证码。
          </ToneAlert>
        ) : null}
      </SectionCard>

      {batch.length > 0 ? (
        <SectionCard
          title={
            <span className="flex items-center gap-2">
              <DicesIcon className="size-4 text-muted-foreground" />
              本批生成结果
            </span>
          }
          description={`共 ${batch.length} 组 · ${formatDateTime(new Date().toISOString())}`}
          actions={
            <>
              <Button size="xs" variant="outline" onClick={() => void copyBatchAsCsv()}>
                <FileSpreadsheetIcon />
                复制全部(CSV)
              </Button>
              <Button size="xs" variant="ghost" onClick={() => setBatch([])}>
                清空列表
              </Button>
            </>
          }
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>用户名</TableHead>
                <TableHead>邮箱</TableHead>
                <TableHead>密码</TableHead>
                <TableHead className="w-28">强度</TableHead>
                <TableHead className="w-36" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {batch.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <CodeText>{item.username}</CodeText>
                  </TableCell>
                  <TableCell>
                    {item.email ? (
                      <CodeText>{item.email}</CodeText>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <CodeText>{item.password}</CodeText>
                  </TableCell>
                  <TableCell>
                    <StatusBadge tone={strengthTone(item.strength.label)}>
                      {item.strength.label} · {item.strength.entropyBits.toFixed(0)}bit
                    </StatusBadge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <CopyButton value={item.username} label="用户名" />
                      <CopyButton value={item.password} label="密码" />
                      {item.email ? <CopyButton value={item.email} label="邮箱" /> : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SectionCard>
      ) : null}

      <SectionCard
        title={
          <span className="flex items-center gap-2">
            <KeyRoundIcon className="size-4 text-muted-foreground" />
            生成历史
          </span>
        }
        description={`最近 ${history.length} 条（密码加密落盘，读取时解密）`}
        actions={
          history.length > 0 ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="xs" variant="destructive" disabled={clearing}>
                  <Trash2Icon />
                  清空历史
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>确认清空全部生成记录？</AlertDialogTitle>
                  <AlertDialogDescription>
                    共 {history.length} 条记录将被永久删除，该操作不可撤销。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>取消</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void clearHistory()}>确认清空</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null
        }
      >
        {history.length === 0 ? (
          <EmptyHint
            icon={KeyRoundIcon}
            title="暂无生成记录"
            description="点击右上角「生成」按钮后，结果会自动记录在这里。"
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>用户名</TableHead>
                <TableHead>邮箱</TableHead>
                <TableHead>密码</TableHead>
                <TableHead className="w-24">强度</TableHead>
                <TableHead className="w-36">生成时间</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <CodeText>{item.username}</CodeText>
                  </TableCell>
                  <TableCell>
                    {item.email ? (
                      <CodeText>{item.email}</CodeText>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <CodeText>{item.password}</CodeText>
                  </TableCell>
                  <TableCell>
                    <StatusBadge tone={strengthTone(item.strength.label)}>{item.strength.label}</StatusBadge>
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                    {formatDateTime(item.createdAt)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <CopyButton value={item.password} />
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        title="删除该条记录"
                        onClick={() => void removeOne(item.id)}
                      >
                        <Trash2Icon className="text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>

      {accounts.length === 0 ? (
        <ToneAlert tone="warn">
          目前还没有配置任何邮箱账号，只能生成用户名与密码。若需要自动接收目标网站的验证码，请先到「邮箱管理」添加 2925
          主邮箱。
        </ToneAlert>
      ) : null}
    </>
  );
}
