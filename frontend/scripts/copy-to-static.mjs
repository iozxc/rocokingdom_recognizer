// npm run build 后自动把前端产物同步到根项目 static 目录：
//   html   -> D:\game\RocoKingdom\static\index.html
//   资源   -> D:\game\RocoKingdom\static\assets\（index.css / index.js 等）
// 只做覆盖/新增，不会删除 static 里已有的其他文件（icon.jpg、qrcode.png 等）。
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendDir = dirname(dirname(fileURLToPath(import.meta.url)));
const distDir = join(frontendDir, 'dist');
const staticDir = join(frontendDir, '..', 'static');

if (!existsSync(join(distDir, 'index.html'))) {
  console.error('[copy-to-static] 未找到 dist/index.html，请先执行 vite build');
  process.exit(1);
}

mkdirSync(staticDir, { recursive: true });
mkdirSync(join(staticDir, 'assets'), { recursive: true });

copyFileSync(join(distDir, 'index.html'), join(staticDir, 'index.html'));

const srcAssets = join(distDir, 'assets');
const dstAssets = join(staticDir, 'assets');
for (const name of readdirSync(srcAssets)) {
  copyFileSync(join(srcAssets, name), join(dstAssets, name));
}

// 注意：elements、map 与 mapdata_real 等静态资源无需在 postbuild 阶段重复复制，改为按需手动维护。

console.log('[copy-to-static] 已同步: static/index.html + static/assets/*');
