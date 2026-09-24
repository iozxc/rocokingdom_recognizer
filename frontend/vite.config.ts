import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync } from 'fs';
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
  /*
   * 纯 web 版的轻量 SEO 收尾（零新增文件，全部内联在这里）。
   *
   * 背景：纯前端版是 SPA，产物 index.html 只有一个空 #root + 一个 JS bundle，图鉴数据还带
   * 加密。不执行 JS 的爬虫（百度蜘蛛默认、Bing 的一部分、社交/聚合平台的预览抓取）拿到的
   * 就是一个空页：没有标题语义，也没有任何可读正文。
   *
   * 这里只做三件成本极低的事，且**不新增任何需要抓取的独立页面**：
   *   1) 给 index.html 注入一段 <noscript> 的真实文案摘要。启用 JS 的浏览器把 noscript
   *      内容当纯文本、完全不渲染，所以正常用户零影响（不闪烁、不多余元素）；
   *   2) 产出 robots.txt，并顺带 Disallow 掉 /data、/models、/wasm 这些几十 MB 的二进制，
   *      别让爬虫把抓取配额浪费在模型文件上（这反而是省请求）；
   *   3) 产出只含首页的 sitemap.xml，给爬虫一个明确入口。
   *
   * 站点地址可用环境变量 ROCO_SITE_URL 覆盖（默认线上域名）。
   * 桌面构建（mode=production）不挂这个插件，行为与原来完全一致。
   */
  const siteUrl = (process.env.ROCO_SITE_URL || 'https://roco.omisheep.cn').replace(/\/+$/, '');

  /**
   * 首页摘要：给不执行 JS 的爬虫看的真实文案。
   * 用自然语句描述站点做什么，不要堆砌关键词（堆词会被判作弊，反而降权）。
   */
  const seoNoscript = [
    '<noscript>',
    '<div style="max-width:760px;margin:24px auto;padding:0 16px;',
    "font-family:system-ui,-apple-system,'Microsoft YaHei',sans-serif;line-height:1.8;color:#1e293b\">",
    '<h1 style="font-size:22px">洛克王国徽章试炼助手</h1>',
    '<p>《洛克王国》徽章试炼的精灵识别与图鉴工具。截图或上传游戏画面，在浏览器本地识别当前地图、',
    '阶段与精灵槽位，并跳到图鉴对应条目；也可以直接按精灵名、图鉴编号、技能名或技能描述检索，',
    '查看每只精灵的属性、特性、技能类型与能耗、威力。跟随识别会实时把识别结果同步到图鉴，',
    '遇到过的精灵会自动记录。</p>',
    '<p>识别全部在浏览器本地完成，游戏画面不会上传、也不需要登录，记录只保存在本机浏览器里。</p>',
    '<p>提示：当前浏览器禁用了 JavaScript，识别与图鉴交互需要启用 JavaScript 才能使用。</p>',
    '</div>',
    '</noscript>',
  ].join('');

  const webSeoPlugin = {
    name: 'roco-web-seo',
    apply: 'build' as const,
    transformIndexHtml(html: string) {
      return html.replace('<div id="root"></div>', '<div id="root"></div>' + seoNoscript);
    },
    closeBundle() {
      const outDir = path.resolve(__dirname, 'dist-web');
      const robots = [
        '# 洛克王国徽章试炼助手（纯前端版）',
        'User-agent: *',
        'Allow: /',
        '',
        '# 大体积二进制资源：对收录没有价值，屏蔽以节省抓取配额',
        'Disallow: /data/',
        'Disallow: /models/',
        'Disallow: /wasm/',
        '',
        'Sitemap: ' + siteUrl + '/sitemap.xml',
        '',
      ].join('\n');
      const sitemap = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        '<url>',
        '<loc>' + siteUrl + '/</loc>',
        '<lastmod>' + new Date().toISOString().slice(0, 10) + '</lastmod>',
        '<changefreq>weekly</changefreq>',
        '<priority>1.0</priority>',
        '</url>',
        '</urlset>',
        '',
      ].join('\n');
      try {
        writeFileSync(path.join(outDir, 'robots.txt'), robots, 'utf-8');
        writeFileSync(path.join(outDir, 'sitemap.xml'), sitemap, 'utf-8');
      } catch (e) {
        console.warn('[seo] 写入 robots.txt / sitemap.xml 失败（忽略，不影响构建）:', e);
      }
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
    plugins: isWeb ? [react(), tailwindcss(), webTitlePlugin, webSeoPlugin] : [react(), tailwindcss()],
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
