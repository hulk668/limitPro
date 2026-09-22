/**
 * Next.js `output: 'standalone'` 不会自动复制 .next/static 与 public，
 * 但 Electron 以 standalone server 方式启动时两者是必需的。
 * 该脚本在 `next build` 之后执行，把静态资源拷贝进 standalone 目录。
 */
import { cpSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const standaloneDir = path.join(root, '.next', 'standalone');

if (!existsSync(standaloneDir)) {
  console.error('[prepare-standalone] 未找到 .next/standalone，请先执行 `npm run build`');
  process.exit(1);
}

const copies = [
  { from: path.join(root, '.next', 'static'), to: path.join(standaloneDir, '.next', 'static') },
  { from: path.join(root, 'public'), to: path.join(standaloneDir, 'public') },
];

for (const { from, to } of copies) {
  if (!existsSync(from)) {
    console.log(`[prepare-standalone] 跳过（不存在）: ${from}`);
    continue;
  }
  if (!statSync(from).isDirectory()) {
    console.log(`[prepare-standalone] 跳过（非目录）: ${from}`);
    continue;
  }
  cpSync(from, to, { recursive: true });
  console.log(`[prepare-standalone] 已复制: ${path.relative(root, from)} -> ${path.relative(root, to)}`);
}

console.log('[prepare-standalone] 完成，standalone 目录已可直接被 Electron 启动。');
