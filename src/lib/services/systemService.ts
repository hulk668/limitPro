/**
 * 系统服务 —— 与「本机运行环境」相关的操作（当前只有数据目录）。
 *
 * ## 设计要点：数据目录只允许有一个权威来源
 *
 * 数据目录的**唯一真相**是 `config.dataDir`，即：
 *   `LIMITPRO_DATA_DIR`（绝对路径） → 未设置时回退到 `<进程 cwd>/.data`
 *
 * 因此各运行方式下的真实目录是：
 *   - `pnpm dev`（next dev 独立启动，cwd = 项目根）：`<项目根>/.data`
 *   - 打包后的 Electron（主进程把 `LIMITPRO_DATA_DIR` 指向 userData）：
 *     `%APPDATA%/<appName>/data`
 *
 * **绝不允许渲染进程或 Electron 主进程再各自拼一次这条路径。**
 * 历史教训：原先 Electron 主进程的 `open-data-dir` IPC 硬编码了
 * `path.join(app.getPath('userData'), 'data')`，而 dev 模式下 Electron 并不托管
 * Next 服务（服务由 `next dev` 独立启动），于是「打开数据目录」按钮打开的是
 * `%APPDATA%/limitpro/data` 这个**空目录**，与后端真正读写的 `<项目根>/.data` 不一致。
 * 现在统一由本模块解析路径并打开，界面只负责调用。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { config, ensureDataDir } from '../config';
import { AppError } from '../errors';
import { logger } from '../logger';

const log = logger.child({ module: 'systemService' });

export type DataDirSource = 'LIMITPRO_DATA_DIR' | 'default';

export type DataDirInfo = {
  /** 后端正在使用的数据目录绝对路径 */
  path: string;
  /** 目录当前是否存在 */
  exists: boolean;
  /** 目录下的一级条目数（用于确认「这里到底有没有数据」） */
  entryCount: number;
  /** 该路径的来源，便于排查机器上并存多份数据 */
  source: DataDirSource;
  /** 后端运行模式，便于区分 dev / 打包后 */
  nodeEnv: string;
};

export type RevealDataDirResult = DataDirInfo & {
  /** 是否已把目录交给系统文件管理器打开（dryRun 时为 false） */
  opened: boolean;
  /** 实际调用的打开命令（dryRun 时为 null） */
  command: string | null;
};

/** 解析数据目录并附带现场信息（只读，不产生副作用） */
export function describeDataDir(): DataDirInfo {
  const dir = config.dataDir;
  const source: DataDirSource =
    typeof process.env.LIMITPRO_DATA_DIR === 'string' && process.env.LIMITPRO_DATA_DIR.trim()
      ? 'LIMITPRO_DATA_DIR'
      : 'default';

  let exists = false;
  let entryCount = 0;
  try {
    if (fs.statSync(dir).isDirectory()) {
      exists = true;
      entryCount = fs.readdirSync(dir).length;
    }
  } catch {
    /* 目录不存在或不可读：保持 exists=false / entryCount=0 */
  }

  return { path: dir, exists, entryCount, source, nodeEnv: config.nodeEnv };
}

/**
 * 用系统文件管理器打开指定目录。
 *
 * Windows 用 `explorer.exe`：**它会以非 0 退出码返回（即使成功打开）**，
 * 所以这里只等待 `spawn` 事件（确认进程真的拉起来了），不校验退出码。
 * 若命令不存在（如 Linux 缺 xdg-open），会触发 ENOENT → 明确报错，
 * 而不是静默失败让用户以为按钮坏了。
 *
 * ## ⚠️ 绝不要加 `windowsHide: true`
 *
 * 这个参数在 Windows 上会以 `CREATE_NO_WINDOW` 创建子进程，导致 explorer 的
 * **文件夹窗口完全不显示**；而 `spawn` 事件照样触发、`opened` 照样为 true，
 * 于是表现为「按钮点了有提示、但目录根本没弹出来」——一个完美的假阳性。
 *
 * 实测对照（6 组，每种策略各跑一次，用 EnumWindows 枚举 CabinetWClass 判定）：
 *   explorer.exe + detached + windowsHide:true  → 无窗口 ❌
 *   powershell Start-Process + windowsHide:true → 无窗口 ❌
 *   rundll32 + windowsHide:true                 → 无窗口 ❌
 *   explorer.exe + detached                     → 窗口出现 ✅
 *   explorer.exe 朴素调用                       → 窗口出现 ✅
 *   cmd /c start "" <dir>                       → 窗口出现 ✅
 *
 * 结论：三者只要带 `windowsHide: true` 就静默失败，不带就正常。此处保持
 * `detached: true` + `stdio: 'ignore'`（让文件管理器独立于后端进程存活），
 * 仅**不设置** `windowsHide`。
 */
async function openInFileManager(dir: string): Promise<string> {
  const platform = process.platform;
  const [command, args] =
    platform === 'win32'
      ? ['explorer.exe', [dir]]
      : platform === 'darwin'
        ? ['open', [dir]]
        : ['xdg-open', [dir]];

  // 注意：这里刻意不传 windowsHide —— 见上方注释，传了会导致窗口不显示
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });

  try {
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('spawn', () => resolve());
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw AppError.storage(`无法调用系统文件管理器打开目录（命令 ${command}）：${reason}`, { dir });
  }

  // 交由系统托管，父进程退出时不牵连这个子进程
  child.unref();
  return command;
}

/**
 * 打开数据目录。
 * @param options.dryRun 为 true 时只返回路径与现场信息，不真正打开
 *   —— 供自动化测试与「只想看看路径」的场景使用。
 */
export async function revealDataDir(options: { dryRun?: boolean } = {}): Promise<RevealDataDirResult> {
  const dryRun = options.dryRun === true;

  // 目录不存在时先建出来，否则文件管理器会打开到一个报错页
  ensureDataDir();

  if (dryRun) {
    return { ...describeDataDir(), opened: false, command: null };
  }

  const command = await openInFileManager(config.dataDir);
  log.info('已请求系统文件管理器打开数据目录', { dir: config.dataDir, command });
  return { ...describeDataDir(), opened: true, command };
}

export const systemService = { describeDataDir, revealDataDir };
