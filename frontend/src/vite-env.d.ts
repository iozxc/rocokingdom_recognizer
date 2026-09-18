/// <reference types="vite/client" />

/** 构建期注入的真实 App 版本（来自仓库根 version.json），仅用于显示。 */
declare const __ROCO_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_ROCO_AUTH_SERVER?: string;
}
