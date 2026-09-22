'use client';

import {
  CodeText,
  EmptyHint,
  LoadingButton,
  SectionCard,
  StatusBadge,
  ToneAlert,
  connectionTone,
  formatDateTime,
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
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { ApiError, api, describeApiError, type MetaInfo, type PublicMailAccount } from '@/lib/client/api';
import { notify } from '@/lib/notify';
import { AtSignIcon, PlugZapIcon, ShieldCheckIcon, Trash2Icon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

type Props = {
  accounts: PublicMailAccount[];
  accountsLoading: boolean;
  meta: MetaInfo | null;
  reload: () => Promise<void>;
};

export function MailAccounts({ accounts, accountsLoading, meta, reload }: Props) {
  const [label, setLabel] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [imapHost, setImapHost] = useState('imap.2925.com');
  const [imapPort, setImapPort] = useState(993);
  const [secure, setSecure] = useState(true);
  const [verify, setVerify] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const touchedRef = useRef(false);

  // 后端默认值下发后填充表单（用户已手动修改则不覆盖）
  useEffect(() => {
    if (!meta || touchedRef.current) return;
    setImapHost(meta.mail.defaults.host);
    setImapPort(meta.mail.defaults.port);
    setSecure(meta.mail.defaults.secure);
  }, [meta]);

  const markTouched = () => {
    touchedRef.current = true;
  };

  const useRecommended = () => {
    markTouched();
    setImapHost('imap.2925.com');
    setImapPort(993);
    setSecure(true);
    notify('已填入 2925 推荐参数（imap.2925.com:993 / SSL）', 'ok');
  };

  const usePlainFallback = () => {
    markTouched();
    setImapHost('imap.2925.com');
    setImapPort(143);
    setSecure(false);
    notify('已切换为明文端口 143（部分线路可用）', 'warn');
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setFieldErrors({});
    try {
      const { account } = await api.accounts.create({
        label,
        email,
        password,
        imapHost,
        imapPort,
        secure,
        verify,
      });
      notify(`已添加邮箱 ${account.email}`, 'ok');
      setLabel('');
      setEmail('');
      setPassword('');
      await reload();
    } catch (error) {
      if (error instanceof ApiError) {
        setFieldErrors(error.fieldErrors);
      }
      notify(describeApiError(error), 'err');
    } finally {
      setSubmitting(false);
    }
  };

  const handleTest = async (id: string) => {
    setBusyId(id);
    try {
      const { connection } = await api.accounts.test(id);
      notify(`连接成功：INBOX 共 ${connection.messageCount} 封邮件`, 'ok');
      await reload();
    } catch (error) {
      notify(describeApiError(error), 'err');
      await reload();
    } finally {
      setBusyId(null);
    }
  };

  const handleRemove = async (id: string) => {
    setBusyId(id);
    try {
      await api.accounts.remove(id);
      notify('已删除邮箱账号', 'ok');
      await reload();
    } catch (error) {
      notify(describeApiError(error), 'err');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <SectionCard
        title={
          <span className="flex items-center gap-2">
            <AtSignIcon className="size-4 text-muted-foreground" />
            添加 2925 邮箱账号
          </span>
        }
        description="登录名必须是主邮箱完整地址；子邮箱 / 别名无法登录客户端，但其邮件会汇总到主邮箱收件箱"
        actions={
          <>
            <Button size="xs" variant="outline" onClick={useRecommended}>
              2925 推荐参数
            </Button>
            <Button size="xs" variant="outline" onClick={usePlainFallback}>
              改用明文 143
            </Button>
          </>
        }
      >
        <ToneAlert tone="info" className="mb-4">
          密码以 <span className="font-semibold">AES-256-GCM</span>{' '}
          加密后保存在本机数据目录，不会明文落盘、不会写入日志。默认会在保存前做一次真实 IMAP 连接校验，凭据错误时立即报错且不入库。
        </ToneAlert>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="account-label">备注名</FieldLabel>
            <Input
              id="account-label"
              value={label}
              placeholder="例如：主力邮箱"
              onChange={(event) => {
                markTouched();
                setLabel(event.target.value);
              }}
            />
            <FieldDescription>留空则使用邮箱地址</FieldDescription>
          </Field>

          <Field data-invalid={Boolean(fieldErrors.email)}>
            <FieldLabel htmlFor="account-email">邮箱地址（主邮箱）</FieldLabel>
            <Input
              id="account-email"
              value={email}
              placeholder="yourname@2925.com"
              aria-invalid={Boolean(fieldErrors.email)}
              onChange={(event) => {
                markTouched();
                setEmail(event.target.value);
              }}
            />
            <FieldError errors={fieldErrors.email ? [{ message: fieldErrors.email }] : undefined} />
          </Field>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Field data-invalid={Boolean(fieldErrors.password)}>
            <FieldLabel htmlFor="account-password">邮箱密码（主邮箱密码）</FieldLabel>
            <Input
              id="account-password"
              type="password"
              value={password}
              placeholder="••••••••"
              autoComplete="off"
              aria-invalid={Boolean(fieldErrors.password)}
              onChange={(event) => {
                markTouched();
                setPassword(event.target.value);
              }}
            />
            {fieldErrors.password ? (
              <FieldError errors={[{ message: fieldErrors.password }]} />
            ) : (
              <FieldDescription>支持客户端专用密码</FieldDescription>
            )}
          </Field>

          <Field data-invalid={Boolean(fieldErrors.imapHost)}>
            <FieldLabel htmlFor="account-host">IMAP 服务器</FieldLabel>
            <Input
              id="account-host"
              value={imapHost}
              placeholder="imap.2925.com"
              aria-invalid={Boolean(fieldErrors.imapHost)}
              onChange={(event) => {
                markTouched();
                setImapHost(event.target.value);
              }}
            />
            <FieldError errors={fieldErrors.imapHost ? [{ message: fieldErrors.imapHost }] : undefined} />
          </Field>

          <Field data-invalid={Boolean(fieldErrors.imapPort)}>
            <FieldLabel htmlFor="account-port">IMAP 端口</FieldLabel>
            <Input
              id="account-port"
              value={String(imapPort)}
              inputMode="numeric"
              aria-invalid={Boolean(fieldErrors.imapPort)}
              onChange={(event) => {
                markTouched();
                setImapPort(Number(event.target.value.replace(/\D/g, '')) || 0);
              }}
            />
            {fieldErrors.imapPort ? (
              <FieldError errors={[{ message: fieldErrors.imapPort }]} />
            ) : (
              <FieldDescription>993 = SSL/TLS，143 = 明文</FieldDescription>
            )}
          </Field>
        </div>

        <Separator className="my-4" />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-5">
            <div className="flex items-center gap-2">
              <Switch
                id="account-secure"
                checked={secure}
                onCheckedChange={(value) => {
                  markTouched();
                  setSecure(value);
                  setImapPort((current) =>
                    current === 993 || current === 143 ? (value ? 993 : 143) : current,
                  );
                }}
              />
              <Label htmlFor="account-secure" className="text-xs font-normal text-muted-foreground">
                启用 SSL/TLS
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="account-verify" checked={verify} onCheckedChange={setVerify} />
              <Label htmlFor="account-verify" className="text-xs font-normal text-muted-foreground">
                保存前校验连接
              </Label>
            </div>
          </div>
          <LoadingButton
            loading={submitting}
            disabled={!email || !password}
            onClick={() => void handleSubmit()}
          >
            <ShieldCheckIcon />
            {submitting ? '校验并保存中…' : '校验并保存'}
          </LoadingButton>
        </div>
      </SectionCard>

      <SectionCard
        title={
          <span className="flex items-center gap-2">
            <AtSignIcon className="size-4 text-muted-foreground" />
            已配置账号
          </span>
        }
        description={`共 ${accounts.length} 个`}
      >
        {accountsLoading ? (
          <EmptyHint icon={AtSignIcon} title="正在加载账号…" />
        ) : accounts.length === 0 ? (
          <EmptyHint
            icon={AtSignIcon}
            title="暂无邮箱账号"
            description="使用上方的表单添加一个 2925 主邮箱后即可开始提取验证码。"
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-40">备注</TableHead>
                <TableHead>邮箱 / 服务器</TableHead>
                <TableHead className="w-24">状态</TableHead>
                <TableHead className="w-36">最近检测</TableHead>
                <TableHead className="w-40" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((account) => (
                <TableRow key={account.id}>
                  <TableCell className="font-medium">{account.label}</TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <CodeText>{account.email}</CodeText>
                      <span className="text-xs text-muted-foreground">
                        {account.imapHost}:{account.imapPort} · {account.secure ? 'SSL/TLS' : '明文'}
                        {account.lastError ? ` · ${account.lastError}` : ''}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge tone={connectionTone(account.lastStatus)}>
                      {account.lastStatus === 'ok' ? '正常' : account.lastStatus === 'error' ? '异常' : '未检测'}
                    </StatusBadge>
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                    {account.lastCheckedAt ? formatDateTime(account.lastCheckedAt) : '—'}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={busyId === account.id}
                        onClick={() => void handleTest(account.id)}
                      >
                        <PlugZapIcon />
                        测试连接
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="icon-xs" variant="ghost" title="删除该账号">
                            <Trash2Icon className="text-destructive" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>确认删除该邮箱账号？</AlertDialogTitle>
                            <AlertDialogDescription>
                              将删除 <CodeText>{account.email}</CodeText> 的本地配置（含加密保存的密码）。
                              已提取的验证码历史不会被删除。
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>取消</AlertDialogCancel>
                            <AlertDialogAction onClick={() => void handleRemove(account.id)}>
                              确认删除
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
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
