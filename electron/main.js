/**
 * limitPro —— Electron 主进程
 *
 * 职责：
 *  1. 开发模式：加载 `next dev` 启动的本地服务 (ELECTRON_START_URL)
 *  2. 生产模式：以子进程方式启动 Next.js standalone server（自动分配空闲端口），
 *     待 /api/health 就绪后再加载窗口
 *  3. 窗口生命周期、单实例锁、外链拦截、优雅停机
 *
 * 设计说明：把 Next.js 放在子进程中运行（进程隔离），
 * 避免 Next 的 dev 模式 worker 影响 Electron 主进程稳定性。
 */
'use strict';

const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const { spawn } = require('node:child_process');

const isDev = !app.isPackaged;
const DEV_SERVER_URL = process.env.ELECTRON_START_URL || 'http://127.0.0.1:3210';
const SERVER_READY_TIMEOUT_MS = 45_000;

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {import('node:child_process').ChildProcess | null} */
let serverProcess = null;
let serverUrl = DEV_SERVER_URL;
let isQuitting = false;

/* -------------------------------------------------------------------------- */
/* 工具函数                                                                    */
/* -------------------------------------------------------------------------- */

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => (port ? resolve(port) : reject(new Error('无法分配空闲端口'))));
    });
  });
}

function probeHealth(url) {
  return new Promise((resolve) => {
    const req = http.get(`${url}/api/health`, { timeout: 2000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probeHealth(url)) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

function resolveStandaloneEntry() {
  const candidates = [
    path.join(process.resourcesPath || '', 'app', '.next', 'standalone', 'server.js'),
    path.join(__dirname, '..', '.next', 'standalone', 'server.js'),
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

/* -------------------------------------------------------------------------- */
/* 生产模式：拉起 Next.js standalone server                                    */
/* -------------------------------------------------------------------------- */

async function startProductionServer() {
  const entry = resolveStandaloneEntry();
  if (!entry) {
    throw new Error(
      '未找到 Next.js 构建产物 (.next/standalone/server.js)。请先执行 `npm run build`，' +
        '或使用 `npm run dev` 进行开发调试。',
    );
  }

  const port = await getFreePort();
  const dataDir = path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  serverProcess = spawn(process.execPath, [entry], {
    cwd: path.dirname(entry),
    env: {
      ...process.env,
      // 让 electron 可执行文件以纯 Node 模式运行服务端脚本
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      PORT: String(port),
      HOSTNAME: '127.0.0.1',
      LIMITPRO_DATA_DIR: dataDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  serverProcess.stdout.on('data', (chunk) => process.stdout.write(`[next] ${chunk}`));
  serverProcess.stderr.on('data', (chunk) => process.stderr.write(`[next] ${chunk}`));
  serverProcess.on('exit', (code) => {
    serverProcess = null;
    if (!isQuitting && code !== 0) {
      console.error(`[limitPro] 后端服务异常退出，退出码 ${code}`);
    }
  });

  serverUrl = `http://127.0.0.1:${port}`;
  const ready = await waitForServer(serverUrl, SERVER_READY_TIMEOUT_MS);
  if (!ready) {
    throw new Error('后端服务启动超时，请检查日志输出。');
  }
  console.log(`[limitPro] 后端已就绪: ${serverUrl}`);
  return serverUrl;
}

function stopProductionServer() {
  if (!serverProcess) return;
  const child = serverProcess;
  serverProcess = null;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], { windowsHide: true });
    } else {
      child.kill('SIGTERM');
    }
  } catch (error) {
    console.error('[limitPro] 关闭后端服务失败:', error);
  }
}

/* -------------------------------------------------------------------------- */
/* 窗口                                                                        */
/* -------------------------------------------------------------------------- */

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#0d1117',
    title: 'limitPro',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow && mainWindow.show());

  // 外部链接交给系统浏览器，不在应用内打开
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:\/\//i.test(target)) shell.openExternal(target);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, target) => {
    if (!target.startsWith(url)) {
      event.preventDefault();
      if (/^https?:\/\//i.test(target)) shell.openExternal(target);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.loadURL(url);

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

/* -------------------------------------------------------------------------- */
/* 启动流程                                                                    */
/* -------------------------------------------------------------------------- */

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    ipcMain.handle('limitpro:app-info', () => ({
      version: app.getVersion(),
      platform: process.platform,
      mode: isDev ? 'development' : 'production',
      serverUrl,
      isPackaged: app.isPackaged,
    }));

    /*
     * 注意：这里刻意不再提供 `open-data-dir` 之类的 IPC。
     * 数据目录的权威来源是后端（config.dataDir = LIMITPRO_DATA_DIR 或 <cwd>/.data），
     * 渲染进程统一调用 POST /api/system/reveal-data-dir 由后端解析并打开。
     * 历史上主进程在这里用 path.join(app.getPath('userData'), 'data') 自己拼了一次路径，
     * 而开发模式下托管 Next 服务的是 `next dev`（cwd = 项目根，数据在 <项目根>/.data），
     * 结果按钮打开的是 %APPDATA%/limitpro/data 这个空目录。不要再把路径推导搬回主进程。
     */

    try {
      const url = isDev ? DEV_SERVER_URL : await startProductionServer();
      createWindow(url);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[limitPro] 启动失败:', message);
      const { dialog } = require('electron');
      dialog.showErrorBox('limitPro 启动失败', message);
      app.quit();
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(serverUrl);
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    isQuitting = true;
    stopProductionServer();
  });
}
