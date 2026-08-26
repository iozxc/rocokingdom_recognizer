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

// 同步属性图标目录（frontend/public/elements -> dist/elements -> static/elements）
const srcElements = join(distDir, 'elements');
const dstElements = join(staticDir, 'elements');
if (existsSync(srcElements)) {
  mkdirSync(dstElements, { recursive: true });
  for (const name of readdirSync(srcElements)) {
    copyFileSync(join(srcElements, name), join(dstElements, name));
  }
}

// 同步地图切片目录（frontend/public/map -> dist/map -> static/map）
function copyFolderRecursive(src, dst) {
  if (!existsSync(src)) return;
  mkdirSync(dst, { recursive: true });
  for (const item of readdirSync(src, { withFileTypes: true })) {
    const srcPath = join(src, item.name);
    const dstPath = join(dst, item.name);
    if (item.isDirectory()) {
      copyFolderRecursive(srcPath, dstPath);
    } else {
      copyFileSync(srcPath, dstPath);
    }
  }
}
const srcMap = join(distDir, 'map');
const dstMap = join(staticDir, 'map');
if (existsSync(srcMap)) {
  copyFolderRecursive(srcMap, dstMap);
}

console.log('[copy-to-static] 已同步: static/index.html + static/assets/* + static/elements/* + static/map/*');
