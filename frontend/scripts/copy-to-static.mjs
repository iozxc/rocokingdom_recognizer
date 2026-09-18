// npm run build 后自动把前端产物同步到根项目 static 目录：
//   html   -> D:\game\RocoKingdom\static\index.html
//   资源   -> D:\game\RocoKingdom\static\assets\（index.css / index.js 等）
// 只做覆盖/新增，不会删除 static 里已有的其他文件（icon.jpg、qrcode.png 等）。
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function copyDir(srcDir, dstDir) {
  if (!existsSync(srcDir)) return;
  mkdirSync(dstDir, { recursive: true });
  for (const name of readdirSync(srcDir)) {
    const src = join(srcDir, name);
    const dst = join(dstDir, name);
    if (statSync(src).isDirectory()) {
      copyDir(src, dst);
    } else {
      copyFileSync(src, dst);
    }
  }
}

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
const copiedAssets = new Set();
for (const name of readdirSync(srcAssets)) {
  copyFileSync(join(srcAssets, name), join(dstAssets, name));
  copiedAssets.add(name);
}

// 桌面版（pywebview + Flask）不会用到浏览器内识别，走的是后端 /init_batch，
// 因此把「只有纯前端版才需要」的大文件从 static 里剔除，避免安装包无谓变大：
//   - ort-wasm-*.wasm / .mjs：onnxruntime-web 运行时（纯前端识别用，20MB+）
//   - recognition.worker-*.js / dino.worker-*.js：浏览器内识别 Worker（后者是旧文件名）
// 顺带清掉历史遗留（本脚本只覆盖不删除，改名/升级后旧 hash 文件会一直堆在 static 里）。
const DESKTOP_UNUSED = [
  /^ort-wasm-.*\.(wasm|mjs)$/i,
  /^recognition\.worker-.*\.js$/i,
  /^dino\.worker-.*\.js$/i,
  // 带 hash 的入口产物：只保留本次构建的，历史 index-*.js/css 一并清掉；
  // 同时清掉改名前的固定名产物（index.js / index.css）
  /^index(-.*)?\.(js|css)$/i,
];
let pruned = 0;
for (const name of readdirSync(dstAssets)) {
  // 本次刚复制过来的文件永不删除
  if (copiedAssets.has(name)) continue;
  if (!DESKTOP_UNUSED.some((re) => re.test(name))) continue;
  try {
    unlinkSync(join(dstAssets, name));
    pruned++;
  } catch {
    /* 占用中/权限问题：忽略，不影响构建 */
  }
}
if (pruned) console.log(`[copy-to-static] 已剔除 ${pruned} 个桌面版不使用的识别资产文件`);

copyDir(join(distDir, 'icon'), join(staticDir, 'icon'));

const glossarySrc = join(frontendDir, '..', 'datasets', 'glossary.json');
if (existsSync(glossarySrc)) {
  mkdirSync(join(staticDir, 'data'), { recursive: true });
  copyFileSync(glossarySrc, join(staticDir, 'data', 'glossary.json'));
}

// 注意：elements 等静态资源无需在 postbuild 阶段重复复制，改为按需手动维护。

console.log('[copy-to-static] 已同步: static/index.html + static/assets/* + static/icon/* + static/data/*');
