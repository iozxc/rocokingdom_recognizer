/// <reference types="vite/client" />

/** 构建期注入的真实 App 版本（来自仓库根 version.json），仅用于显示。 */
declare const __ROCO_VERSION__: string;

/** Web 端上报“打开/心跳”到远端统计服务器的地址（Vercel 环境变量，可选）。 */
interface ImportMetaEnv {
  readonly VITE_ROCO_AUTH_SERVER?: string;
}
