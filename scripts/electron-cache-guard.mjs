/**
 * electron-builder 打包前置检查：校验 electron 的 zip 缓存是否完整。
 *
 * 背景（真实踩坑）：
 *   electron-builder 自带的下载器（Go 写的 app-builder）会把 electron 的发行包缓存到
 *   `%LOCALAPPDATA%/electron/Cache/electron-v<版本>-<平台>-<架构>.zip`。
 *   国内网络直连 GitHub 下载时容易**被截断**（实测下到 105MB / 完整应约 110MB），
 *   而这个下载器**不校验完整性**，直接把残缺 zip 当有效缓存解压。
 *   解压结果会缺 electron.exe 等文件，最终在「把 electron.exe 重命名为 <productName>.exe」
 *   这一步抛出误导性极强的报错：
 *
 *     ENOENT: no such file or directory, rename
 *       'release\win-unpacked\electron.exe' -> 'release\win-unpacked\limitPro.exe'
 *
 *   报错指向 win-unpacked，让人以为是权限或残留文件问题，实际根因在缓存。
 *
 * 本脚本做的事：扫描缓存里所有 electron zip，用 ZIP 结束记录（EOCD）做一次廉价但有效的
 * 完整性判定；不完整的直接删掉，让打包流程重新下载一份好的，并打印明确的中文提示。
 *
 * 注意：本脚本永远以 0 退出 —— 它是「修复步骤」而不是「门禁」。
 *       缓存完好时不做任何事，删掉坏缓存也不算失败（重新下载即可）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** 各平台 electron 缓存的默认位置（与 @electron/get / app-builder 保持一致） */
function resolveCacheDirs() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    return [path.join(base, 'electron', 'Cache'), path.join(base, 'electron-builder', 'Cache', 'electron')];
  }
  if (process.platform === 'darwin') {
    return [path.join(home, 'Library', 'Caches', 'electron')];
  }
  return [process.env.XDG_CACHE_HOME || path.join(home, '.cache'), path.join(home, '.cache', 'electron')].map((dir) =>
    path.join(dir, 'electron'),
  );
}

/**
 * 判断 zip 是否完整：从文件尾部找 EOCD（PK\x05\x06），
 * 并校验「中央目录偏移 + 大小」是否落在文件长度之内。
 * 文件被截断时，这两个判据至少有一个不成立 —— 正是本次故障的特征。
 */
function inspectZip(file) {
  const size = fs.statSync(file).size;
  if (size < 22) return { ok: false, reason: '文件过小，不可能是完整的 zip' };

  const tailLength = Math.min(66_000, size); // EOCD 固定 22 字节 + 最多 65535 字节注释
  const tail = Buffer.allocUnsafe(tailLength);
  const fd = fs.openSync(file, 'r');
  try {
    fs.readSync(fd, tail, 0, tailLength, size - tailLength);
  } finally {
    fs.closeSync(fd);
  }

  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i -= 1) {
    if (tail.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return { ok: false, reason: '找不到 ZIP 结束记录（文件被截断）' };

  const cdSize = tail.readUInt32LE(eocd + 12);
  const cdOffset = tail.readUInt32LE(eocd + 16);
  // ZIP64 会把这两个字段填成 0xFFFFFFFF，本检查器无法判定 —— 放行，避免误删好文件
  if (cdOffset === 0xffffffff || cdSize === 0xffffffff) return { ok: true };

  if (cdOffset + cdSize > size) {
    const mb = (n) => `${(n / 1024 / 1024).toFixed(1)}MB`;
    return {
      ok: false,
      reason: `中央目录越界（偏移 ${mb(cdOffset)} + 大小 ${mb(cdSize)} > 文件 ${mb(size)}）`,
    };
  }
  return { ok: true };
}

function main() {
  const dirs = resolveCacheDirs().filter((dir) => {
    try {
      return fs.statSync(dir).isDirectory();
    } catch {
      return false;
    }
  });

  if (dirs.length === 0) {
    console.log('[cache-guard] 未发现 electron 缓存目录，跳过检查（首次构建会正常下载）');
    return;
  }

  let checked = 0;
  let removed = 0;

  for (const dir of dirs) {
    // 同时覆盖两种缓存布局：直接放在根目录的，以及放在 <sha256>/ 子目录里的
    const targets = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isFile() && /^electron-v.+\.zip$/i.test(entry.name)) {
        targets.push(full);
      } else if (entry.isDirectory()) {
        for (const inner of fs.readdirSync(full)) {
          if (/^electron-v.+\.zip$/i.test(inner)) targets.push(path.join(full, inner));
        }
      }
    }

    for (const zip of targets) {
      checked += 1;
      let verdict;
      try {
        verdict = inspectZip(zip);
      } catch (error) {
        verdict = { ok: false, reason: `读取失败：${error instanceof Error ? error.message : String(error)}` };
      }

      if (verdict.ok) {
        console.log(`[cache-guard] OK   ${zip}`);
        continue;
      }

      console.warn(`[cache-guard] 损坏 ${zip}`);
      console.warn(`[cache-guard]      原因：${verdict.reason}`);
      try {
        fs.rmSync(zip, { force: true });
        removed += 1;
        console.warn('[cache-guard]      已删除，打包时会重新下载一份完整的 electron');
      } catch (error) {
        console.warn(`[cache-guard]      删除失败（请手动删除）：${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  console.log(`[cache-guard] 检查 ${checked} 个缓存文件，清理 ${removed} 个损坏文件`);
}

main();
