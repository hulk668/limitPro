/**
 * Electron 预加载脚本 —— 仅暴露最小化的、白名单化的能力给渲染进程。
 *
 * 说明：渲染进程（Next.js 页面）默认全部走 HTTP 调用本地后端，包括「打开数据目录」
 * （POST /api/system/reveal-data-dir）。这里刻意不提供任何文件系统 / 路径推导能力，
 * 避免主进程与后端对「数据目录在哪」产生第二套答案。
 */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('limitProDesktop', {
  /** 获取应用版本 / 运行模式 / 后端地址 */
  getAppInfo: () => ipcRenderer.invoke('limitpro:app-info'),
  isDesktop: true,
});
