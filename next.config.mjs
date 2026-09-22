/** @type {import('next').NextConfig} */
const nextConfig = {
  // 供 Electron 以子进程方式启动（next build 会产出 .next/standalone/server.js）
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  // imapflow / mailparser 是纯 Node 原生依赖，不能被打包器 bundle
  serverExternalPackages: ['imapflow', 'mailparser'],
  eslint: {
    // 桌面端项目不阻塞构建流程
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
