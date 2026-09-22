/**
 * UI 真实渲染验证 —— 用无头 Edge + CDP 真实点击驱动，补上 `tsc` / `next build` 覆盖不到的一层。
 *
 * 用法：
 *   1) 先启动后端：pnpm dev 或 pnpm start:web
 *   2) 另开终端执行：pnpm verify:ui
 *      指定地址：LIMITPRO_UI_BASE=http://127.0.0.1:3211 pnpm verify:ui
 *      顺便截图：LIMITPRO_UI_SHOT=docs/screenshots/04-about.png pnpm verify:ui
 *
 * ## 为什么需要它
 * `pnpm typecheck` 通过 + `pnpm build` 通过 **不等于界面能跑**：水合失败、事件处理器没挂上、
 * 下拉默认值不在选项里、文字被 grid 布局拆行等问题只在真实渲染中暴露。
 *
 * ## 两条必须遵守的规则（都踩过坑）
 * 1. **必须等 React 水合完成再点击。** Next.js 的 SSR HTML 在 hydration 之前就已经包含业务文案，
 *    若只等「页面出现某段文字」就 click，点击会落在尚未挂载处理器的节点上，
 *    表现为「点了没反应」的假故障。判据：DOM 节点上出现 `__reactFiber$` / `__reactProps$`。
 * 2. **断言错误覆盖层不能只看 `nextjs-portal`。**它是 Next 开发模式的常驻容器，无错误也存在；
 *    要查它的 shadowRoot 里有没有 `#nextjs__container_errors_label`。
 *    另外必须在 `Page.navigate` **之前**开启 Runtime/Log 监听，否则抓不到加载期的报错。
 *
 * 本脚本的**核心回归断言**：界面「关于 → 本地数据与安全」显示的路径必须等于 `/api/health`
 * 报告的数据目录 —— 即「打开数据目录」的目标与后端真实读写的目录是同一个。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.LIMITPRO_UI_BASE ?? 'http://127.0.0.1:3210';
const SHOT = process.env.LIMITPRO_UI_SHOT;
const CDP_PORT = Number(process.env.LIMITPRO_UI_CDP_PORT ?? 9339);

/** Edge 常见安装位置（找不到就跳过，不硬失败） */
const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/microsoft-edge',
  '/usr/bin/microsoft-edge-stable',
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  \u2713 ${name}`);
  } else {
    failed += 1;
    console.error(`  \u2717 ${name}${detail ? `\n      ${detail}` : ''}`);
  }
}

const edgePath = EDGE_CANDIDATES.find((candidate) => fs.existsSync(candidate));
if (!edgePath) {
  console.error('\n[ui-verify] 未找到 Microsoft Edge，跳过 UI 验证。');
  console.error('            可通过修改脚本顶部的 EDGE_CANDIDATES 指定浏览器路径。\n');
  process.exit(0);
}

const userDataDir = path.join(process.env.TEMP ?? process.env.TMPDIR ?? '.', `limitpro-ui-${process.pid}`);
const edge = spawn(
  edgePath,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--disable-extensions',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--window-size=1080,720',
    'about:blank',
  ],
  { windowsHide: true, stdio: 'ignore' },
);

let ws;
let nextId = 1;
const pending = new Map();
const consoleErrors = [];

function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) {
    throw new Error(
      `页面执行异常: ${JSON.stringify(result.exceptionDetails.exception?.description ?? result.exceptionDetails).slice(0, 400)}`,
    );
  }
  return result.result.value;
}

async function waitFor(expression, { timeoutMs = 30000, intervalMs = 250, label = '条件' } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return true;
    await sleep(intervalMs);
  }
  throw new Error(`等待超时: ${label}`);
}

async function main() {
  // ---- 期望值：由后端自己报告，脚本不硬编码任何路径 ----
  const health = await fetch(`${BASE}/api/health`).then((r) => r.json());
  const expectedDataDir = health?.data?.dataDir;
  if (!expectedDataDir) throw new Error('无法从 /api/health 取得 dataDir');

  console.log(`\n[ui-verify] ${BASE}`);
  console.log(`[ui-verify] 后端报告的数据目录: ${expectedDataDir}\n`);

  // ---- 连接无头浏览器 ----
  let target = null;
  for (let attempt = 0; attempt < 40 && !target; attempt += 1) {
    await sleep(300);
    try {
      const list = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`).then((r) => r.json());
      target = list.find((item) => item.type === 'page');
    } catch {
      /* 调试端点尚未就绪 */
    }
  }
  if (!target?.webSocketDebuggerUrl) throw new Error('未能连接到无头 Edge 调试端点');

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
      return;
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      consoleErrors.push(message.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    }
    if (message.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(message.params.exceptionDetails?.exception?.description ?? 'exceptionThrown');
    }
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      consoleErrors.push(message.params.entry.text);
    }
  });

  // 先开监听再导航，才能抓到加载期的错误
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: `${BASE}/` });

  console.log('· 页面加载与水合');
  await waitFor(`document.body.innerText.includes('limitPro')`, { label: '应用外壳渲染' });
  await waitFor(
    `Array.from(document.querySelectorAll('[data-slot="sidebar-menu-button"]')).some((b) => Object.keys(b).some((k) => k.startsWith('__reactFiber$')))`,
    { label: 'React 水合完成' },
  );
  check('应用外壳渲染完成', true);
  check('React 已水合（事件处理器已挂载）', true);

  const shellText = await evaluate(`document.body.innerText`);
  check('侧边栏存在「打开数据目录」按钮', shellText.includes('打开数据目录'));
  // 健康检查是挂载后异步拉取的，这里等徽标变成正常，顺带验证前端到后端的连通性
  const healthOk = await waitFor(`/正常|后端就绪/.test(document.body.innerText)`, {
    timeoutMs: 15000,
    label: '后端状态徽标变为正常',
  }).catch(() => false);
  check('前端可连通后端（状态徽标为正常）', healthOk);

  console.log('\n· 数据目录单一来源（回归断言）');
  await evaluate(`
    (() => {
      const btn = Array.from(document.querySelectorAll('[data-slot="sidebar-menu-button"]'))
        .find((b) => b.textContent.includes('关于'));
      if (!btn) return 'not-found';
      btn.click();
      return 'clicked';
    })()
  `);
  await waitFor(`document.querySelector('h1')?.textContent?.includes('关于')`, { label: '切换到「关于」页' });
  check('可切换到「关于」页', true);

  // 把路径安全地嵌进被测页面的 JS 表达式（JSON.stringify 会正确转义反斜杠）
  const pathLiteral = JSON.stringify(expectedDataDir);
  const pathRendered = await waitFor(`document.body.innerText.includes(${pathLiteral})`, {
    timeoutMs: 20000,
    label: '数据目录路径渲染',
  }).catch(() => false);

  const aboutText = await evaluate(`document.body.innerText`);
  check('「关于」页含「本地数据与安全」区块', aboutText.includes('本地数据与安全'));
  check(
    '界面显示的数据目录 == 后端实际使用的数据目录',
    pathRendered && aboutText.includes(expectedDataDir),
    `期望 ${expectedDataDir}；页面未匹配到该路径`,
  );
  check('显示路径来源标注', /来自环境变量|默认（项目根 \.data）/.test(aboutText));
  check('显示目录文件数徽标', /\d+ 个文件|目录为空/.test(aboutText));
  const openEntryCount = await evaluate(
    `Array.from(document.querySelectorAll('button')).filter((b) => b.textContent.includes('打开数据目录')).length`,
  );
  check('侧边栏与关于页都提供打开入口', openEntryCount >= 2, `实际 ${openEntryCount}`);

  console.log('\n· 运行时报错检查');
  const overlay = await evaluate(`
    (() => {
      const portal = document.querySelector('nextjs-portal');
      const label = portal?.shadowRoot?.querySelector('#nextjs__container_errors_label');
      const body = document.body.innerText;
      return {
        overlayLabel: label ? label.textContent : null,
        hasRuntimeError: body.includes('Unhandled Runtime Error') || body.includes('Failed to compile'),
      };
    })()
  `);
  check('无 Next.js 错误覆盖层', !overlay.overlayLabel && !overlay.hasRuntimeError, JSON.stringify(overlay));
  check('无 console 报错', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' || '));

  if (SHOT) {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync(path.dirname(path.resolve(SHOT)), { recursive: true });
    fs.writeFileSync(path.resolve(SHOT), Buffer.from(shot.data, 'base64'));
    console.log(`\n  截图已保存: ${path.resolve(SHOT)}`);
  }

  console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
}

main()
  .catch((error) => {
    failed += 1;
    console.error(`\n  \u2717 执行异常: ${error.message}`);
  })
  .finally(async () => {
    try {
      ws?.close();
    } catch {
      /* ignore */
    }
    edge.kill();
    await sleep(500);
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    process.exit(failed > 0 ? 1 : 0);
  });
