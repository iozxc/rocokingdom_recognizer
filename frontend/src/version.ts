/**
 * 前台展示的 App 版本号。
 *
 * 构建时由 vite.config.ts 读取仓库根 `version.json` 里的真实版本，
 * 通过 `define` 注入到 __ROCO_VERSION__，保证与后端 config.APP_VERSION / version.json 一致。
 * 未注入时回退到默认值，便于类型检查。
 */
export const APP_VERSION: string = __ROCO_VERSION__ || '1.4.4';

// 注：网页版不再使用独立版本号，统一读仓库根 version.json（即 APP_VERSION，与桌面一致）。
// 原 frontend/web-version.json 已弃用；/data/*.json 的缓存版本参数也直接用 APP_VERSION。

/**
 * onnxruntime-web 的版本号（构建时从 node_modules 读出并注入）。
 * /wasm/ort-wasm-*.wasm 是固定文件名，升级 ORT 后会变成另一个 URL，
 * 这样那批文件就能安全地长期缓存。
 */
export const ORT_VERSION: string = __ROCO_ORT_VERSION__ || '0.0.0';
