/**
 * 前台展示的 App 版本号。
 *
 * 构建时由 vite.config.ts 读取仓库根 `version.json` 里的真实版本，
 * 通过 `define` 注入到 __ROCO_VERSION__，保证与后端 config.APP_VERSION / version.json 一致。
 * 未注入时回退到默认值，便于类型检查。
 */
export const APP_VERSION: string = __ROCO_VERSION__ || '1.4.4';

/**
 * 纯 Web 版自己的版本号。
 *
 * 网页版是独立部署的（改一次前端就发一次），跟桌面 App 的版本号不是一回事，
 * 所以单独维护在 frontend/web-version.json：由 vite.config.ts 读入后注入。
 * 它同时用作 /data/*.json 的缓存版本参数（改动前端静态数据时递增即可）。
 */
export const WEB_VERSION: string = __ROCO_WEB_VERSION__ || '0.0.0';

/**
 * onnxruntime-web 的版本号（构建时从 node_modules 读出并注入）。
 * /wasm/ort-wasm-*.wasm 是固定文件名，升级 ORT 后会变成另一个 URL，
 * 这样那批文件就能安全地长期缓存。
 */
export const ORT_VERSION: string = __ROCO_ORT_VERSION__ || '0.0.0';
