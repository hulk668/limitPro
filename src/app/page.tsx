'use client';

import { CodeInbox } from '@/components/CodeInbox';
import { CredentialGenerator } from '@/components/CredentialGenerator';
import { MailAccounts } from '@/components/MailAccounts';
import { CodeText, LoadingButton, SectionCard, StatusBadge, ToneAlert } from '@/components/shared';
import { Separator } from '@/components/ui/separator';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api, describeApiError, type DataDirInfo, type HealthInfo, type MetaInfo, type PublicMailAccount } from '@/lib/client/api';
import { notify } from '@/lib/notify';
import {
  AtSignIcon,
  FolderOpenIcon,
  InfoIcon,
  InboxIcon,
  KeyRoundIcon,
  ServerIcon,
  ShieldCheckIcon,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

type TabKey = 'inbox' | 'generate' | 'accounts' | 'about';

const TABS: Array<{ key: TabKey; label: string; icon: LucideIcon; title: string; desc: string }> = [
  {
    key: 'inbox',
    label: '验证码收件箱',
    icon: InboxIcon,
    title: '验证码收件箱',
    desc: '连接 2925 邮箱拉取来信，用多信号打分精准提取其中的验证码，支持自动轮询等待',
  },
  {
    key: 'generate',
    label: '账号生成器',
    icon: KeyRoundIcon,
    title: '随机账号生成器',
    desc: '批量生成随机用户名与高强度密码，可直接复制为 CSV 或 2925 别名邮箱',
  },
  {
    key: 'accounts',
    label: '邮箱管理',
    icon: AtSignIcon,
    title: '邮箱账号管理',
    desc: '配置 2925 主邮箱的 IMAP 参数，保存前自动做一次真实连通性校验',
  },
  {
    key: 'about',
    label: '关于',
    icon: InfoIcon,
    title: '关于 limitPro',
    desc: '架构说明、接口清单与使用须知',
  },
];

const ENDPOINTS: Array<{ method: string; path: string; desc: string }> = [
  { method: 'GET', path: '/api/health', desc: '健康检查（Electron 主进程据此判断后端就绪）' },
  { method: 'GET', path: '/api/meta', desc: '下发后端默认值与各项限制，避免前端硬编码' },
  { method: 'GET', path: '/api/accounts', desc: '邮箱账号列表（不含密码）' },
  { method: 'POST', path: '/api/accounts', desc: '新增邮箱账号（默认校验连通性后入库）' },
  { method: 'PATCH', path: '/api/accounts/:id', desc: '修改账号信息 / 密码' },
  { method: 'DELETE', path: '/api/accounts/:id', desc: '删除账号' },
  { method: 'POST', path: '/api/accounts/:id/test', desc: '手动触发 IMAP 连通性检测' },
  { method: 'POST', path: '/api/mail/fetch', desc: '拉取邮件并提取验证码（前端轮询此端点）' },
  { method: 'GET', path: '/api/codes', desc: '验证码提取历史' },
  { method: 'DELETE', path: '/api/codes', desc: '清空提取历史（可按账号）' },
  { method: 'POST', path: '/api/credentials/generate', desc: '批量生成随机账号与密码' },
  { method: 'GET', path: '/api/credentials', desc: '生成记录（密码解密后返回）' },
  { method: 'DELETE', path: '/api/credentials/:id', desc: '删除单条生成记录' },
  { method: 'POST', path: '/api/system/reveal-data-dir', desc: '打开后端真实使用的数据目录（dryRun 只查询路径）' },
];

function methodTone(method: string): 'ok' | 'err' | 'info' {
  if (method === 'GET') return 'info';
  if (method === 'DELETE') return 'err';
  return 'ok';
}

export default function Page() {
  const [tab, setTab] = useState<TabKey>('inbox');
  const [accounts, setAccounts] = useState<PublicMailAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [meta, setMeta] = useState<MetaInfo | null>(null);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [openingDataDir, setOpeningDataDir] = useState(false);
  /** 后端数据目录的现场信息（dryRun 查询，不会弹出文件夹） */
  const [dataDirInfo, setDataDirInfo] = useState<DataDirInfo | null>(null);

  const reloadAccounts = useCallback(async () => {
    setAccountsLoading(true);
    try {
      const data = await api.accounts.list();
      setAccounts(data.accounts);
    } catch (error) {
      notify(describeApiError(error), 'err');
    } finally {
      setAccountsLoading(false);
    }
  }, []);

  useEffect(() => {
    void reloadAccounts();
    void api
      .meta()
      .then(setMeta)
      .catch(() => undefined);
    void api
      .health()
      .then((info) => {
        setHealth(info);
        setHealthError(null);
      })
      .catch((error) => setHealthError(describeApiError(error)));
    // dryRun：只问路径与现场信息，不弹出系统文件夹
    void api
      .system.revealDataDir(true)
      .then(setDataDirInfo)
      .catch(() => undefined);
  }, [reloadAccounts]);

  /**
   * 打开数据目录。
   * 路径一律由后端返回（后端是数据目录的唯一权威来源），
   * 前端不做任何路径拼接 —— 否则 dev 与打包环境会各算一套，指向不同的目录。
   */
  const openDataDir = useCallback(async () => {
    setOpeningDataDir(true);
    try {
      const info = await api.system.revealDataDir();
      setDataDirInfo(info);
      if (info.opened) {
        notify(`已打开数据目录：${info.path}`, 'ok');
      } else {
        notify(`数据目录：${info.path}（未能自动打开，请手动前往）`, 'warn');
      }
    } catch (error) {
      notify(describeApiError(error), 'err');
    } finally {
      setOpeningDataDir(false);
    }
  }, []);

  const activeTab = TABS.find((item) => item.key === tab) ?? TABS[0];

  return (
    <SidebarProvider className="h-svh overflow-hidden">
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" className="cursor-default hover:bg-transparent active:bg-transparent">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-chart-4 text-sm font-bold text-primary-foreground">
                  LP
                </div>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate font-semibold">limitPro</span>
                  <span className="truncate text-xs text-muted-foreground">验证码提取 · 账号生成</span>
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>功能</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {TABS.map((item) => (
                  <SidebarMenuItem key={item.key}>
                    <SidebarMenuButton
                      tooltip={item.label}
                      isActive={tab === item.key}
                      onClick={() => setTab(item.key)}
                    >
                      <item.icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter>
          <div className="flex flex-col gap-2 rounded-lg border bg-card p-3 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
            <div className="flex items-center justify-between gap-2">
              <span>后端服务</span>
              <StatusBadge tone={health ? 'ok' : healthError ? 'err' : 'muted'}>
                {health ? '正常' : healthError ? '异常' : '检测中'}
              </StatusBadge>
            </div>
            {health ? (
              <>
                <div className="flex items-center gap-1.5">
                  <ServerIcon className="size-3.5" />
                  <span>
                    v{health.version} · {health.nodeEnv}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <ShieldCheckIcon className="size-3.5" />
                  <span>
                    账号 {health.storage.accounts} · 验证码 {health.storage.codes} · 凭据{' '}
                    {health.storage.credentials}
                  </span>
                </div>
              </>
            ) : healthError ? (
              <span className="text-destructive">{healthError}</span>
            ) : null}
          </div>
          <LoadingButton
            variant="outline"
            size="sm"
            className="justify-start"
            loading={openingDataDir}
            onClick={() => void openDataDir()}
          >
            <FolderOpenIcon />
            <span className="group-data-[collapsible=icon]:hidden">打开数据目录</span>
          </LoadingButton>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset className="overflow-hidden">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="h-5" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold">{activeTab.title}</h1>
            <p className="truncate text-xs text-muted-foreground">{activeTab.desc}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <StatusBadge tone={health ? 'ok' : healthError ? 'err' : 'muted'}>
              {health ? '后端就绪' : healthError ? '后端异常' : '连接中'}
            </StatusBadge>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="mx-auto flex max-w-6xl flex-col gap-4">
            {tab === 'inbox' ? (
              <CodeInbox
                accounts={accounts}
                accountsLoading={accountsLoading}
                meta={meta}
                onGoToAccounts={() => setTab('accounts')}
              />
            ) : null}

            {tab === 'generate' ? <CredentialGenerator accounts={accounts} meta={meta} /> : null}

            {tab === 'accounts' ? (
              <MailAccounts
                accounts={accounts}
                accountsLoading={accountsLoading}
                meta={meta}
                reload={reloadAccounts}
              />
            ) : null}

            {tab === 'about' ? (
              <>
                <SectionCard title="这是什么" description="limitPro · Next.js + Electron 全栈桌面应用">
                  <p className="text-sm text-muted-foreground">
                    limitPro 是一个本地桌面工具，把「注册账号时最费神的两个环节」自动化：
                  </p>
                  <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-sm">
                    <li>
                      <span className="font-medium text-foreground">验证码提取</span>
                      <span className="text-muted-foreground">
                        ：对接 2925 邮箱 IMAP，从收到的邮件中精准识别验证码，支持自动轮询等待（找到即停）。
                      </span>
                    </li>
                    <li>
                      <span className="font-medium text-foreground">账号密码生成</span>
                      <span className="text-muted-foreground">
                        ：使用密码学安全随机数批量生成随机用户名与强密码，可同时产出 2925
                        别名邮箱，一键复制为 CSV。
                      </span>
                    </li>
                  </ul>
                </SectionCard>

                <SectionCard title="架构说明" description="控制器 → 服务层 → 仓储层，三层单向依赖">
                  <div className="grid gap-5 sm:grid-cols-2">
                    <div>
                      <div className="text-xs font-medium text-muted-foreground">技术栈</div>
                      <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
                        <li>桌面壳：Electron（主进程以子进程方式托管 Next.js 服务）</li>
                        <li>后端：Next.js Route Handlers（Node runtime）</li>
                        <li>前端：React 19 + Tailwind CSS v4 + shadcn/ui</li>
                        <li>邮件：imapflow + mailparser</li>
                        <li>数据：本地 JSON 集合（原子写 + 写操作串行化），密码 AES-256-GCM 加密</li>
                      </ul>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-muted-foreground">工程约定</div>
                      <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
                        <li>配置全部来自环境变量，启动时集中校验、快速失败</li>
                        <li>类型化错误体系 + 全局错误处理器，客户端看不到堆栈</li>
                        <li>结构化 JSON 日志并携带 requestId，敏感字段自动脱敏</li>
                        <li>所有输入在边界处校验，不信任客户端</li>
                        <li>4xx 不重试，5xx / 网络错误退避重试（最多 3 次）</li>
                      </ul>
                    </div>
                  </div>

                  <Separator className="my-4" />

                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-24">方法</TableHead>
                        <TableHead className="w-64">路径</TableHead>
                        <TableHead>说明</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ENDPOINTS.map((endpoint) => (
                        <TableRow key={`${endpoint.method}-${endpoint.path}`}>
                          <TableCell>
                            <StatusBadge tone={methodTone(endpoint.method)}>{endpoint.method}</StatusBadge>
                          </TableCell>
                          <TableCell>
                            <CodeText>{endpoint.path}</CodeText>
                          </TableCell>
                          <TableCell className="text-muted-foreground">{endpoint.desc}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </SectionCard>

                <SectionCard title="2925 邮箱注意事项" description="这几条是踩坑总结，务必先读">
                  <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-muted-foreground">
                    <li>
                      <span className="font-medium text-foreground">登录名必须是主邮箱完整地址</span>（如{' '}
                      <CodeText>name@2925.com</CodeText>），密码为主邮箱密码；子邮箱 / 别名不能直接登录 IMAP 客户端。
                    </li>
                    <li>
                      <span className="font-medium text-foreground">IMAP 服务器不支持 SEARCH 命令</span>
                      ，因此本工具不发送任何服务端检索条件，而是「取邮件总数 → 按序号 FETCH → 本地按时间过滤」。
                    </li>
                    <li>
                      官方推荐 <CodeText>imap.2925.com:993 (SSL/TLS)</CodeText>；若连接失败可改用{' '}
                      <CodeText>143</CodeText> 并关闭 SSL。
                    </li>
                    <li>别名邮件会统一投递到主邮箱收件箱，所以用主邮箱账号即可捕获所有别名的验证码。</li>
                  </ul>
                </SectionCard>

                <SectionCard
                  title="本地数据与安全"
                  description="数据目录由后端唯一决定，下面显示的即后端实际读写的路径"
                  actions={
                    <LoadingButton
                      variant="outline"
                      size="xs"
                      loading={openingDataDir}
                      onClick={() => void openDataDir()}
                    >
                      <FolderOpenIcon />
                      <span>打开数据目录</span>
                    </LoadingButton>
                  }
                >
                  <div className="mb-3 rounded-md border bg-muted/40 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-medium text-muted-foreground">当前数据目录</span>
                      <StatusBadge tone={dataDirInfo?.source === 'LIMITPRO_DATA_DIR' ? 'info' : 'muted'}>
                        {dataDirInfo?.source === 'LIMITPRO_DATA_DIR' ? '来自环境变量' : '默认（项目根 .data）'}
                      </StatusBadge>
                      {dataDirInfo ? (
                        <StatusBadge tone={dataDirInfo.entryCount > 0 ? 'ok' : 'warn'}>
                          {dataDirInfo.entryCount > 0 ? `${dataDirInfo.entryCount} 个文件` : '目录为空'}
                        </StatusBadge>
                      ) : null}
                    </div>
                    <div className="mt-2 break-all">
                      <CodeText className="text-xs">
                        {dataDirInfo?.path ?? health?.dataDir ?? '（读取中…）'}
                      </CodeText>
                    </div>
                  </div>
                  <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-muted-foreground">
                    <li>
                      邮箱密码、生成的账号密码：AES-256-GCM 加密后落盘，密钥位于数据目录的 keyring 文件（权限
                      0600）。
                    </li>
                    <li>日志自动脱敏 password / token / secret 等字段，不会记录明文凭据。</li>
                    <li>后端仅监听 127.0.0.1，不对外暴露端口。</li>
                    <li>
                      开发模式（<CodeText>pnpm dev</CodeText>）用项目根下的 <CodeText>.data</CodeText>
                      ；打包后的应用用 Electron 用户数据目录。两者互不影响，可分别备份 accounts.json /
                      codes.json / credentials.json。
                    </li>
                  </ul>
                </SectionCard>

                <ToneAlert tone="warn" title="使用须知">
                  请仅将本工具用于你自己拥有或已获授权的邮箱与站点，以及合法的开发测试场景。批量注册行为通常违反目标平台的服务条款，
                  请遵守相关平台规则与法律法规，不要用于任何违法或侵害他人权益的用途。
                </ToneAlert>
              </>
            ) : null}
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
