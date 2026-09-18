/**
 * 静态图鉴模式开关。
 *
 * 通过 Vite 构建 mode 区分：
 * - 默认 `vite build`（mode=production）→ 桌面打包：IS_STATIC = false，行为与原来完全一致。
 * - `vite build --mode web`（用于 Vercel）→ 纯前端图鉴：IS_STATIC = true，
 *   前端改用本地静态数据/图片，并隐藏依赖本机后端的功能（识别、授权、更新、反馈等）。
 */
export const IS_STATIC: boolean = import.meta.env.MODE === 'web';

export const PLATFORM: 'app' | 'web' = IS_STATIC ? 'web' : 'app';
