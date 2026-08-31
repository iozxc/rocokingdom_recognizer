/**
 * 前台展示的 App 版本号。
 *
 * 构建时由 vite.config.ts 读取仓库根 `version.json` 里的真实版本，
 * 通过 `define` 注入到 __ROCO_VERSION__，保证与后端 config.APP_VERSION / version.json 一致。
 * 未注入时回退到默认值，便于类型检查。
 */
export const APP_VERSION: string = __ROCO_VERSION__ || '1.4.4';
