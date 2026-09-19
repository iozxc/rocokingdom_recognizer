/// <reference types="vite/client" />

/** 构建期注入的真实 App 版本（来自仓库根 version.json），仅用于显示。 */
declare const __ROCO_VERSION__: string;
/** 纯 Web 版自己的版本号（frontend/web-version.json），仅 web 构建展示与做缓存版本参数。 */
declare const __ROCO_WEB_VERSION__: string;
/** onnxruntime-web 的版本号（构建时从 node_modules 读取），用于 /wasm/* 的版本参数。 */
declare const __ROCO_ORT_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_ROCO_AUTH_SERVER?: string;
}

/**
 * 运行时别名 `ort-lazy-webgpu`（见 vite.config.ts）：指向 onnxruntime-web 的
 * 「非 bundle」ESM 入口 dist/ort.webgpu.min.mjs。
 * 它与主入口是同一套 API，类型直接复用官方声明；之所以必须换成非 bundle 版，
 * 见 workers/recognition.worker.ts 顶部注释（pthread 子 Worker 脚本解析问题）。
 */
declare module 'ort-lazy-webgpu' {
  export * from 'onnxruntime-web/webgpu';
}
