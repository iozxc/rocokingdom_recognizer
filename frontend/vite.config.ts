import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'fs';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(({ mode }) => {
  // 纯前端图鉴版：`vite build --mode web`，输出独立 dist-web，使用独立 public-web。
  // 默认构建（桌面打包，mode=production）保持原样：outDir=dist、publicDir=public、base='./'。
  const isWeb = mode === 'web';

  /**
   * 纯 web 版把页面标题与桌面端主窗口标题区分开。
   *
   * 桌面端单实例检测是按窗口标题找窗口的（FindWindowW），而纯 web 页面的 <title>
   * 原本与桌面主窗口标题完全一样；用户只要在浏览器里开着那个页面，
   * 桌面 app 启动时就会误判成"已有实例在运行"而直接退出。
   * 桌面构建（mode=production）保持原标题不变，只影响纯 web 产物。
   * （新版桌面端还加了"窗口归属进程校验"双重保险，这里是为了让已经发出去的旧版本也免疫。）
   */
  const webTitlePlugin = {
    name: 'roco-web-title-suffix',
    transformIndexHtml(html: string) {
      return html
          .replace(/<title>([^<]*)<\/title>/, '<title>$1 · 网页版</title>')
          .replace(/(<meta property="og:title" content="[^"]*)"/, '$1 · 网页版"');
    },
  };
  // 读取仓库根 version.json 里的真实版本，注入到 __ROCO_VERSION__ 供前端展示。
  let appVersion = '1.4.4';
  try {
    const ver = JSON.parse(readFileSync(path.resolve(__dirname, '..', 'version.json'), 'utf-8'));
    if (ver && typeof ver.version === 'string') appVersion = ver.version;
  } catch {
    // 读不到时保持默认，不影响构建
  }
  // onnxruntime-web 的版本：/wasm/* 是固定文件名，升级 ORT 时必须换 URL 才能安全长缓存。
  let ortVersion = '0.0.0';
  try {
    const pkg = JSON.parse(readFileSync(
        path.resolve(__dirname, 'node_modules/onnxruntime-web/package.json'), 'utf-8'));
    if (pkg && typeof pkg.version === 'string') ortVersion = pkg.version;
  } catch {
    // 读不到时保持默认，不影响构建
  }
  return {
    base: isWeb ? '/' : './', // web(纯前端)用绝对路径；桌面用相对路径以便 Flask 托管
    plugins: isWeb ? [react(), tailwindcss(), webTitlePlugin] : [react(), tailwindcss()],
    define: {
      __ROCO_VERSION__: JSON.stringify(appVersion),
      __ROCO_ORT_VERSION__: JSON.stringify(ortVersion),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
        // onnxruntime-web 的 "./webgpu" 导出是 bundle 版：Emscripten 的 wasm 工厂会被内联进
        // worker，Vite 打成 iife 后 import.meta.url 变成 self.location.href，多线程 WASM 的
        // pthread 子 Worker 就会去加载识别 worker 自己而死锁。这里指向非 bundle 的 ESM 入口，
        // 让工厂改由运行时从 /wasm/ 动态 import（import.meta.url 才是它自己的 URL）。
        'ort-lazy-webgpu': path.resolve(
            __dirname, 'node_modules/onnxruntime-web/dist/ort.webgpu.min.mjs'),
      },
    },
    publicDir: isWeb ? 'public-web' : 'public',
    build: {
      outDir: isWeb ? 'dist-web' : 'dist',
      assetsDir: 'assets',
      emptyOutDir: true,
      rollupOptions: {
        output: {
          // 带内容 hash：/assets/* 才能安全地长期缓存（改代码 → 文件名变化 → index.html 引用新文件）
          entryFileNames: 'assets/[name]-[hash].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash].[ext]',
        },
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
