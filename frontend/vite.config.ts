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
  return {
    base: isWeb ? '/' : './', // web(纯前端)用绝对路径；桌面用相对路径以便 Flask 托管
    plugins: isWeb ? [react(), tailwindcss(), webTitlePlugin] : [react(), tailwindcss()],
    define: {
      __ROCO_VERSION__: JSON.stringify(appVersion),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    publicDir: isWeb ? 'public-web' : 'public',
    build: {
      outDir: isWeb ? 'dist-web' : 'dist',
      assetsDir: 'assets',
      emptyOutDir: true,
      rollupOptions: {
        output: {
          entryFileNames: 'assets/[name].js',
          chunkFileNames: 'assets/[name].js',
          assetFileNames: 'assets/[name].[ext]',
        },
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
