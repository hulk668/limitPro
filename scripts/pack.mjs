/**
 * 打包入口：`node scripts/pack.mjs [--win] [其他 electron-builder 参数]`
 *
 * 为什么需要它 —— 解决一个很容易踩、但报错完全指错方向的失败：
 *
 *   ⨯ remove ...\release\win-unpacked\resources\app.asar:
 *       The process cannot access the file because it is being used by another process.
 *
 * electron-builder 每次构建都会先清空输出目录（`EnsureEmptyDir`），只要里面有**任何一个**
 * 文件被别的进程以不含 FILE_SHARE_DELETE 的方式打开着，构建就直接失败。而这在真实开发环境里
 * 很常见：IDE 的文件索引/监听、资源管理器窗口、安全软件的实时扫描都会持有这类句柄。
 * 更麻烦的是，被内存映射的文件还会**阻止其所在目录改名**，于是「删不掉也改不了名」。
 *
 * 本脚本的处理顺序：
 *   1. 能删就删 —— 正常情况，零成本；
 *   2. 删不掉就改名成 `release.stale-<时间戳>` —— 把路让开，本次仍输出到 `release`；
 *   3. 连改名都失败就自动切到 `release-<时间戳>` 输出，并打印醒目的清理指引。
 *
 * 无论如何都保证构建能跑完 —— 输出目录只是产物，不值得让整个构建失败。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();

/** 国内镜像：electron-builder 的下载器只认环境变量，不认 .npmrc */
const MIRRORS = {
  ELECTRON_MIRROR: 'https://cdn.npmmirror.com/binaries/electron/',
  ELECTRON_BUILDER_BINARIES_MIRROR: 'https://cdn.npmmirror.com/binaries/electron-builder-binaries/',
};

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function dirSize(dir) {
  let total = 0;
  const walk = (d) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        try {
          total += fs.statSync(full).size;
        } catch {
          /* 忽略 */
        }
      }
    }
  };
  walk(dir);
  return total;
}

/**
 * 尝试彻底删除目录。
 * maxRetries 让 Node 对 EBUSY / EPERM 这类瞬时占用自动重试 —— 有些句柄只是短暂存在。
 */
function tryRemoveDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    return true;
  } catch (error) {
    return error;
  }
}

/** 读出 package.json 里配置的输出目录（默认 release） */
function readConfiguredOutput() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    return pkg.build?.directories?.output ?? 'release';
  } catch {
    return 'release';
  }
}

/** 顺手清理历史遗留的 *.stale-* / release-<时间戳> 目录（失败就算了，不影响构建） */
function cleanLeftovers(base) {
  const pattern = new RegExp(`^${base}(\\.stale-\\d{8}-\\d{6}|-\\d{8}-\\d{6})$`);
  let names;
  try {
    names = fs.readdirSync(ROOT);
  } catch {
    return;
  }
  for (const name of names) {
    if (!pattern.test(name)) continue;
    const dir = path.join(ROOT, name);
    try {
      if (!fs.statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    const result = tryRemoveDir(dir);
    if (result === true) {
      console.log(`[pack] 已清理历史遗留目录 ${name}`);
    } else {
      const mb = (dirSize(dir) / 1024 / 1024).toFixed(0);
      console.warn(`[pack] 遗留目录 ${name}（约 ${mb}MB）仍被占用，删不掉，先留着；重启后可手动删除`);
    }
  }
}

/**
 * 准备好输出目录，返回本次实际使用的目录名。
 *
 * 三级策略，保证「输出目录被占用」永远不会让构建失败：
 *   1. 能删就删 —— 正常情况；
 *   2. 删不掉就改名让路 —— 被内存映射/独占打开的文件会阻止其所在目录改名，
 *      所以这一步经常也会失败（EPERM / EACCES）；
 *   3. 都失败就用固定的兜底目录 `release-fallback` —— 新目录里没有旧文件，谁也没占，
 *      构建必定能跑完。用固定名而不是时间戳，是为了不越积越多。
 */
function prepareOutputDir() {
  const base = readConfiguredOutput();
  const absBase = path.resolve(ROOT, base);

  cleanLeftovers(base);

  if (!fs.existsSync(absBase)) {
    return base;
  }

  const removed = tryRemoveDir(absBase);
  if (removed === true) {
    console.log(`[pack] 已清理上一次的输出目录 ${base}/`);
    return base;
  }

  console.warn(`[pack] 清不掉 ${base}/：${removed.code ?? ''} ${removed.message.split('\n')[0]}`);
  console.warn('[pack] 这通常是里面的文件正被别的进程打开着（IDE 的编辑器标签/索引、资源管理器窗口、杀软扫描）。');

  const staleName = `${base}.stale-${timestamp()}`;
  try {
    fs.renameSync(absBase, path.resolve(ROOT, staleName));
    console.warn(`[pack] 已把它改名为 ${staleName}/ 让开路，本次仍输出到 ${base}/`);
    console.warn(`[pack] ${staleName}/ 只是垃圾产物，占用解除后删掉即可。`);
    return base;
  } catch (renameError) {
    console.warn(`[pack] 改名也失败（${renameError.code ?? ''}）—— 被单独打开的文件会阻止其所在目录改名。`);

    const fallback = `${base}-fallback`;
    const absFallback = path.resolve(ROOT, fallback);
    if (fs.existsSync(absFallback)) {
      const cleaned = tryRemoveDir(absFallback);
      if (cleaned !== true) {
        const unique = `${base}-${timestamp()}`;
        console.warn(`[pack] 兜底目录 ${fallback}/ 也清不掉，本次改用 ${unique}/。`);
        return unique;
      }
    }

    console.warn(`[pack] 本次改用 ${fallback}/ 作为输出目录（它里面是空的，构建一定能过）。`);
    console.warn(`[pack] 想恢复到 ${base}/：关掉正打开它的程序（通常是 IDE / 资源管理器窗口），`);
    console.warn(`[pack] 删除 ${base}/ 后再次打包即可自动恢复。`);
    return fallback;
  }
}

/**
 * 拦下「在 A 平台打 B 平台包」的无效组合。
 *
 * electron-builder 只允许在 macOS 上打 macOS 包 —— 这不是配置问题，是 Apple 的工具链限制：
 * dmg 制作依赖 `hdiutil`、签名依赖 `codesign`、公证依赖 `notarytool`，Windows/Linux 上都没有。
 * 直接调 electron-builder 只会得到一句 `Build for macOS is supported only on macOS`，
 * 所以这里提前拦下来，并把可执行的三条路直接写清楚。
 */
function assertPlatformSupported(extraArgs) {
  const wantsMac = extraArgs.some(
    (arg) => arg === '--mac' || (/^-[a-z]+$/i.test(arg) && arg.slice(1).includes('m')),
  );
  if (!wantsMac || process.platform === 'darwin') return;

  console.error('');
  console.error('  ✗ 当前系统是 ' + process.platform + '，无法打包 macOS 安装包。');
  console.error('');
  console.error('    macOS 的 dmg 制作 / 代码签名 / 公证分别依赖 hdiutil、codesign、notarytool，');
  console.error('    这三个工具只存在于 macOS，任何配置都绕不过去（Apple 的限制）。');
  console.error('');
  console.error('  可行的三条路：');
  console.error('    1. 在任意一台 Mac 上执行： pnpm install && pnpm dist:mac');
  console.error('       （Intel / Apple Silicon 机器都可以，产物会同时出 arm64 与 x64 两个包）');
  console.error('    2. 用 GitHub Actions 的 macos runner 云构建：仓库里已备好');
  console.error('       .github/workflows/build-mac.yml，推上去即可在 Actions 页面下载 dmg');
  console.error('    3. 临时租一台云 Mac（按小时计费），把项目拷过去执行第 1 条的命令');
  console.error('');
  process.exit(1);
}

function main() {
  const extraArgs = process.argv.slice(2);
  assertPlatformSupported(extraArgs);

  const output = prepareOutputDir();

  const cli = path.join(ROOT, 'node_modules', 'electron-builder', 'cli.js');
  if (!fs.existsSync(cli)) {
    console.error(`[pack] 找不到 electron-builder（${cli}），请先执行 pnpm install`);
    process.exit(1);
  }

  const env = { ...process.env };
  // 清掉它，避免影响 electron-builder 拉起的子进程（Electron 会因此退化成纯 Node）
  delete env.ELECTRON_RUN_AS_NODE;
  for (const [key, value] of Object.entries(MIRRORS)) {
    if (!env[key]) env[key] = value; // 用户已显式设置则不覆盖
  }

  const args = [cli, `--config.directories.output=${output}`, ...extraArgs];
  console.log(`[pack] electron-builder ${extraArgs.join(' ') || ''} → 输出目录 ${output}/`);

  const result = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit', env });
  if (result.error) {
    console.error(`[pack] 启动 electron-builder 失败：${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`[pack] electron-builder 退出码 ${result.status}`);
    process.exit(result.status ?? 1);
  }

  const absOut = path.resolve(ROOT, output);
  const artifacts = fs.existsSync(absOut)
    ? fs.readdirSync(absOut).filter((n) => !fs.statSync(path.join(absOut, n)).isDirectory())
    : [];
  console.log(`[pack] 完成。产物在 ${output}/ ：${artifacts.join(', ') || '(无)'}`);
  if (output !== readConfiguredOutput()) {
    console.log(`[pack] 注意：本次因输出目录被占用而改用了 ${output}/。`);
  }
}

main();
