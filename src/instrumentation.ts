/**
 * Next.js 启动钩子（服务端进程启动时执行一次）。
 * 在这里做配置集中校验 —— 配置有问题就快速失败，而不是等到某个请求才报错。
 *
 * ⚠️ 两个必须遵守的约束（踩过坑）：
 *
 * 1. Next.js 会把本文件**同时**编译进 `nodejs` 与 `edge` 两个运行时
 *    （即使项目里没有 middleware），而 edge 运行时不存在 `node:fs` / `node:path`。
 *
 * 2. 因此所有 Node 专有依赖必须写在 `if (process.env.NEXT_RUNTIME === 'nodejs') { ... }`
 *    的代码块**内部**。webpack 在 edge 编译时会把该条件常量折叠为 `false` 并整块跳过；
 *    而「提前 return」式守卫 **无效**，因为 webpack 是逐语句静态解析的，
 *    函数体后面的语句依旧会被解析并拉进 edge 图：
 *
 *      // ❌ 报 UnhandledSchemeError: Reading from "node:fs" is not handled by plugins
 *      if (process.env.NEXT_RUNTIME !== 'nodejs') return;
 *      await import('./lib/config');
 *
 *      // ✅ 正确写法
 *      if (process.env.NEXT_RUNTIME === 'nodejs') {
 *        await import('./lib/config');
 *      }
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // 动态导入放在 if 块内部，确保不会被 edge 运行时编译
    const { config, validateConfig } = await import('./lib/config');
    const { logger } = await import('./lib/logger');

    validateConfig();

    logger.info('limitPro 后端已启动', {
      nodeEnv: config.nodeEnv,
      dataDir: config.dataDir,
      port: config.server.port,
      imapDefaults: config.mail.defaults,
      disableServerSearch: config.mail.disableServerSearch,
    });
  }
}
