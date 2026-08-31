import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'fs';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(({ mode }) => {
  // 纯前端图鉴版：`vite build --mode web`，输出独立 dist-web，使用独立 public-web。
  // 默认构建（桌面打包，mode=production）保持原样：outDir=dist、publicDir=public、base='./'。
  const isWeb = mode === 'web';
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
    plugins: [react(), tailwindcss()],
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
