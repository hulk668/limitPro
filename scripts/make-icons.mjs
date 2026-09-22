/**
 * 生成应用图标：`src/app/icon.svg` → `build-assets/icon.icns`（macOS）+ `icon.png`（备用）
 *
 * 为什么要写个脚本而不是塞一张二进制图片进仓库：
 *   界面的品牌图标本来就以 SVG 维护（`src/app/icon.svg`，同时是网页 favicon），
 *   打包用的图标理应从它派生，改配色时不会漏掉安装包图标。
 *
 * 实现要点：
 *   1. 光栅化复用项目里已有的「无头 Edge」方案（与 scripts/ui-verify.mjs 同一套路），
 *      **不引入 sharp / canvas 这类需要编译的依赖**；
 *   2. 每个尺寸都用 Edge 按目标尺寸直接渲染（比先渲染大图再缩放更清晰）；
 *   3. ICNS 容器在纯 Node 里手写 —— 现代 macOS 的 icns 允许直接内嵌 PNG 数据块
 *      （类型 ic07/ic08/ic09/ic10/ic11/ic12），格式简单到不值得引依赖；
 *   4. 生成完**立刻回读校验**（PNG 魔数、块长度、总长度），图标坏了要在打包前就发现。
 *
 * 用法：`node scripts/make-icons.mjs`
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'build-assets');
const TMP_DIR = path.join(ROOT, '_tmp_icons');
const SRC_SVG = path.join(ROOT, 'src', 'app', 'icon.svg');

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/microsoft-edge',
  '/usr/bin/microsoft-edge-stable',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

/**
 * macOS 图标规范：内容占画布约 82%（四周留白），
 * 直接满幅渲染出来的图标看起来会比系统图标大一圈。
 */
const CONTENT_RATIO = 0.82;

/** icns 里要放的尺寸 → PNG 块类型（现代 macOS 只认这几个就够了） */
const ICNS_CHUNKS = [
  ['ic11', 32],
  ['ic12', 64],
  ['ic07', 128],
  ['ic08', 256],
  ['ic09', 512],
  ['ic10', 1024],
];

function findBrowser() {
  const found = EDGE_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    console.error('[icons] 未找到 Edge/Chrome，无法把 SVG 光栅化。');
    console.error(`[icons] 找过这些位置：\n  ${EDGE_CANDIDATES.join('\n  ')}`);
    process.exit(1);
  }
  return found;
}

/** 从 PNG 字节流读宽高（顺带验证它确实是合法 PNG） */
function pngSizeOf(buf) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buf.subarray(0, 8).equals(signature)) {
    throw new Error('不是合法 PNG（文件头不是 PNG 魔数）');
  }
  if (buf.subarray(12, 16).toString('ascii') !== 'IHDR') {
    throw new Error('不是合法 PNG（IHDR 缺失或位置不对）');
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** 读 PNG 文件的宽高 */
function readPngSize(file) {
  return pngSizeOf(fs.readFileSync(file));
}

function writeHtml() {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  fs.copyFileSync(SRC_SVG, path.join(TMP_DIR, 'icon.svg'));
  const html = `<!doctype html>
<meta charset="utf-8">
<title>icon</title>
<style>
  html, body { margin: 0; padding: 0; background: transparent; }
  body { width: 100vw; height: 100vh; display: grid; place-items: center; }
  img { width: ${CONTENT_RATIO * 100}%; height: ${CONTENT_RATIO * 100}%; display: block; }
</style>
<img src="icon.svg" alt="">
`;
  const htmlPath = path.join(TMP_DIR, 'icon.html');
  fs.writeFileSync(htmlPath, html, 'utf8');
  return htmlPath;
}

/** 用无头 Edge 把 HTML 渲染成指定尺寸的透明 PNG */
function renderPng(browser, htmlPath, size) {
  const out = path.join(TMP_DIR, `icon-${size}.png`);
  const result = spawnSync(
    browser,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-sandbox',
      '--no-first-run',
      '--disable-extensions',
      '--force-device-scale-factor=1',
      `--window-size=${size},${size}`,
      '--default-background-color=00000000',
      `--screenshot=${out}`,
      pathToFileURL(htmlPath).href,
    ],
    { encoding: 'utf8', windowsHide: true, timeout: 60_000 },
  );

  if (!fs.existsSync(out)) {
    throw new Error(
      `渲染 ${size}×${size} 失败（无头浏览器没有产出文件）\n` +
        `${result.stderr ?? ''}`.slice(0, 800),
    );
  }
  const { width, height } = readPngSize(out);
  if (width !== size || height !== size) {
    throw new Error(`渲染 ${size}×${size} 得到 ${width}×${height}，尺寸不符`);
  }
  return out;
}

/** 组装 ICNS（PNG 内嵌型），并回读校验 */
function buildIcns(pngByChunk) {
  const parts = [];
  for (const [type, size] of ICNS_CHUNKS) {
    const payload = fs.readFileSync(pngByChunk.get(size));
    const chunk = Buffer.alloc(8 + payload.length);
    chunk.write(type, 0, 4, 'ascii');
    chunk.writeUInt32BE(8 + payload.length, 4);
    payload.copy(chunk, 8);
    parts.push(chunk);
  }
  const body = Buffer.concat(parts);
  const header = Buffer.alloc(8);
  header.write('icns', 0, 4, 'ascii');
  header.writeUInt32BE(8 + body.length, 4);
  const icns = Buffer.concat([header, body]);

  // ── 回读校验：类型、块长度、总长度、以及每块 PNG 的实际尺寸都要自洽 ──
  const expectedTotal = icns.length;
  if (icns.readUInt32BE(4) !== expectedTotal) {
    throw new Error(`icns 头部声明的长度 ${icns.readUInt32BE(4)} != 实际 ${expectedTotal}`);
  }
  const sizeByType = new Map(ICNS_CHUNKS.map(([type, size]) => [type, size]));
  let cursor = 8;
  const seen = [];
  while (cursor < icns.length) {
    const type = icns.subarray(cursor, cursor + 4).toString('ascii');
    const length = icns.readUInt32BE(cursor + 4);
    if (length < 8 || cursor + length > icns.length) {
      throw new Error(`icns 块 ${type} 长度非法：${length}`);
    }
    const payload = icns.subarray(cursor + 8, cursor + length);
    const expected = sizeByType.get(type);
    if (expected === undefined) {
      throw new Error(`icns 里出现了预期外的块类型：${type}`);
    }
    const { width, height } = pngSizeOf(payload);
    if (width !== expected || height !== expected) {
      throw new Error(`icns 块 ${type} 应为 ${expected}×${expected}，实际是 ${width}×${height}`);
    }
    seen.push(`${type}=${width}px(${payload.length}B)`);
    cursor += length;
  }
  if (cursor !== icns.length) {
    throw new Error(`icns 块长度累加 ${cursor} != 文件长度 ${icns.length}`);
  }

  const file = path.join(OUT_DIR, 'icon.icns');
  fs.writeFileSync(file, icns);
  return { file, seen };
}

function main() {
  if (!fs.existsSync(SRC_SVG)) {
    console.error(`[icons] 找不到源图标：${SRC_SVG}`);
    process.exit(1);
  }
  const browser = findBrowser();
  console.log(`[icons] 光栅化工具：${browser}`);
  console.log(`[icons] 源图标：${path.relative(ROOT, SRC_SVG)}`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const htmlPath = writeHtml();

  const pngByChunk = new Map();
  const rendered = [];
  for (const [, size] of ICNS_CHUNKS) {
    const file = renderPng(browser, htmlPath, size);
    pngByChunk.set(size, file);
    rendered.push(`${size}px`);
    console.log(`[icons] 渲染 ${size}×${size} ✓`);
  }

  const { file, seen } = buildIcns(pngByChunk);
  console.log(`[icons] 合成 ${path.relative(ROOT, file)}：${seen.join(', ')}`);

  // 备用：单张 1024 PNG（万一某台机器上 icns 转换/读取有问题，可直接改用这个）
  const fallback = path.join(OUT_DIR, 'icon.png');
  fs.copyFileSync(pngByChunk.get(1024), fallback);
  console.log(`[icons] 备用 ${path.relative(ROOT, fallback)}（1024×1024）`);

  // 清理中间产物
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
  console.log('[icons] 完成，已清理临时目录。');
}

main();
