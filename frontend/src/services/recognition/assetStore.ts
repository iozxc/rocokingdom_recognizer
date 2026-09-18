/**
 * 纯前端识别资产仓库（M2）。
 *
 * 三件事：
 *  1) 读 `data/recognizer-assets.json` 清单（构建期由 tools/export_web_recognizer.py 产出），
 *     拿到资产版本号、字节数、sha256 与量化评测结论；
 *  2) 用 IndexedDB 按「版本 + 路径」缓存模型/特征库 ArrayBuffer：清单版本不变就零下载，
 *     版本一变自动失效重下（不用清缓存，也不会读到半旧资产）；
 *  3) 探测运行环境（WebGPU / 跨域隔离），供上层决定用 fp16 还是 fp32 模型。
 *
 * 清单缺失时全部退化为「直接 fetch」，功能不受影响，只是没有缓存与体积优化。
 */
import axios from 'axios';
import { fetchJson, decryptData, isEncrypted } from '../secureFetch';

export interface RecognizerManifest {
  version: number;
  builtAt?: string;
  scope?: string;
  features: { file: string; meta: string; count: number; dim: number; bytes: number };
  models: Record<string, string>;
  recommended?: { webgpu?: string; wasm?: string };
  eval?: Record<string, { cosine_min?: number; cosine_mean?: number; top1_agreement?: number; bytes?: number }>;
  ocr?: Record<string, { file?: string; bytes?: number; count?: number } | null>;
  /** 跟随识别用的 YOLOv8 版面检测模型（构建期由 tools/export_web_recognizer.py 写入） */
  scanner?: {
    file?: string;
    bytes?: number;
    /** 默认推理边长（正方形输入） */
    imgsz?: number;
    confThresh?: number;
    nmsThresh?: number;
    classes?: Record<string, string>;
  } | null;
  assets?: { path: string; bytes: number; sha256: string }[];
}

const DB_NAME = 'roco-recog-assets';
const DB_VERSION = 1;
const STORE = 'assets';

let manifestPromise: Promise<RecognizerManifest | null> | null = null;
let dbPromise: Promise<IDBDatabase | null> | null = null;

function baseUrl(): string {
  return import.meta.env.BASE_URL || '/';
}

/**
 * 大资产（模型/特征库/OCR）的下载基址。
 * 默认与站点同源；若把模型放到 OSS/CDN（Pages 有单文件体积上限时的常用做法），
 * 构建时设置 VITE_ROCO_ASSET_BASE=https://your-bucket.oss-cn-xxx.aliyuncs.com/roco/ 即可，
 * 页面本身（index.html/js/图标）仍留在 Pages。OSS 侧需要允许跨域（CORS: GET, Origin *）。
 * 注意：清单文件 recognizer-assets.json 始终从站点自身读取，便于发版时刷新版本号。
 */
function assetBaseUrl(): string {
  const env = import.meta.env.VITE_ROCO_ASSET_BASE as string | undefined;
  if (env && env.trim()) {
    const v = env.trim();
    return v.endsWith('/') ? v : `${v}/`;
  }
  return baseUrl();
}

/** 资产版本号：清单里拿不到就用 0（此时不做跨版本失效，只做进程内复用）。 */
export function assetVersion(m: RecognizerManifest | null): number {
  return m && typeof m.version === 'number' ? m.version : 0;
}

export function hasWebGPU(): boolean {
  return typeof navigator !== 'undefined' && !!(navigator as Navigator & { gpu?: unknown }).gpu;
}

export function isCrossOriginIsolated(): boolean {
  return typeof self !== 'undefined' && (self as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;
}

/** 硬件并发度（对齐后端「逻辑核一半」的线程思路）。 */
export function hardwareThreads(): number {
  const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
  return Math.max(1, Math.min(4, Math.ceil(cores / 2)));
}

export function loadManifest(): Promise<RecognizerManifest | null> {
  if (!manifestPromise) {
    manifestPromise = fetchJson<RecognizerManifest>(`${baseUrl()}data/recognizer-assets.json`, 10000)
        .then((r) => (r && typeof r === 'object' ? r : null))
        .catch(() => null);
  }
  return manifestPromise;
}

/** 用户可选的模型档位：体积/精度权衡（都由构建期量化评测给出结论）。 */
export type ModelTier = 'auto' | 'tiny' | 'small' | 'compat';

/** 档位 -> 清单 models 键。auto 按本机能力挑（WebGPU 用 fp16，否则 fp32）。 */
export function tierModelKeys(m: RecognizerManifest | null, tier: ModelTier): string[] {
  const rec = m?.recommended || {};
  switch (tier) {
    case 'tiny':
      return ['int8', 'fp32'];
    case 'small':
      return ['fp16', 'fp32'];
    case 'compat':
      return ['fp32'];
    default:
      return hasWebGPU()
          ? [relToKey(m, rec.webgpu), relToKey(m, rec.wasm), 'fp16', 'fp32']
          : [relToKey(m, rec.wasm), 'fp32', 'fp16'];
  }
}

function relToKey(m: RecognizerManifest | null, rel?: string): string {
  if (!rel || !m?.models) return '';
  for (const [key, value] of Object.entries(m.models)) {
    if (value === rel) return key;
  }
  return '';
}

/** 按档位 + 本机能力排出尝试顺序（去重，均返回相对 BASE_URL 的路径）。 */
export function preferredModels(m: RecognizerManifest | null, tier: ModelTier = 'auto'): string[] {
  const keys = tierModelKeys(m, tier).filter(Boolean);
  if (keys.length) {
    const list = keys.map((k) => m?.models?.[k]).filter((v): v is string => !!v);
    const out: string[] = [];
    for (const item of list) if (!out.includes(item)) out.push(item);
    if (out.length) return out;
  }
  const rec = m?.recommended || {};
  // 部署包里不再包含 fp32（84MB）：兜底只在 fp16 / int8 之间挑
  const list = hasWebGPU()
      ? [rec.webgpu, 'models/dino_fp16.onnx', rec.wasm, 'models/dino_int8.onnx']
      : [rec.wasm, 'models/dino_int8.onnx', 'models/dino_fp16.onnx'];
  const out: string[] = [];
  for (const item of list) {
    if (item && !out.includes(item)) out.push(item);
  }
  return out;
}

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

interface CacheRecord {
  version: number;
  bytes: number;
  buf: ArrayBuffer;
}

async function idbGet(key: string): Promise<CacheRecord | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as CacheRecord) || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbPut(key: string, rec: CacheRecord): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(rec, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function idbDel(key: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * 从构建期清单里查这个资产的期望字节数。
 *
 * 用途：站点缺文件时，ESA/OSS 会把 `index.html` 以 200 返回（SPA 兜底），
 * 光看 HTTP 状态码根本发现不了 —— 只有比对清单里的字节数才能识别出来。
 * 拿不到清单/没登记就返回 null，此时跳过校验（保证不阻塞正常加载）。
 */
async function expectedBytesFor(relPath: string): Promise<number | null> {
  try {
    const m = await loadManifest();
    const hit = (m?.assets || []).find((a) => a && a.path === relPath);
    return hit && typeof hit.bytes === 'number' && hit.bytes > 0 ? hit.bytes : null;
  } catch {
    return null;
  }
}

export async function clearAssetCache(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** 某个资产是否已经在 IndexedDB 里（用于设置面板显示「已下载」）。 */
export async function isAssetCached(relPath: string, version: number): Promise<boolean> {
  if (!relPath) return false;
  const rec = await idbGet(`v${version}:${relPath}`);
  return !!(rec && rec.version === version && rec.buf && rec.buf.byteLength > 0);
}

export interface FetchProgress {
  /** 已下载字节；来自缓存时为总字节（即瞬间完成）。 */
  loaded: number;
  total: number;
  fromCache: boolean;
}

async function fetchWithProgress(url: string, onProgress?: (p: FetchProgress) => void): Promise<ArrayBuffer> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`资产下载失败：HTTP ${resp.status}（${url}）`);
  // 站点把 404 兜底成 index.html 时，缺文件也会返回 200 + text/html：
  // 这里直接拦掉，否则这坨网页会被当成模型丢给推理引擎，
  // 报出来的是 "protobuf parsing failed" 这种完全看不出原因的错误。
  const ctype = (resp.headers.get('content-type') || '').toLowerCase();
  if (ctype.startsWith('text/html')) {
    throw new Error(`识别资产不存在：${url} 返回了网页（一般是部署时漏传了文件），请重新部署站点后再试`);
  }
  const total = Number(resp.headers.get('content-length') || 0);
  if (!resp.body) return resp.arrayBuffer();

  const reader = resp.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.length;
      onProgress?.({ loaded: received, total: total || received, fromCache: false });
    }
  }
  const out = new Uint8Array(received);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out.buffer;
}

/**
 * 取资产（先 IndexedDB 后网络）。
 * @param relPath 相对 BASE_URL 的路径，如 `models/dino_fp16.onnx`
 * @param version 清单版本；变更即视为缓存失效
 */
export async function loadAsset(
    relPath: string,
    version: number,
    onProgress?: (p: FetchProgress) => void
): Promise<ArrayBuffer> {
  const key = `v${version}:${relPath}`;
  const cleanPath = relPath.replace(/^\/+/, '');
  // 带版本号请求：模型/特征库这类文件名固定但内容会随版本变化，
  // 加 ?v=<清单版本> 后 CDN/浏览器就可以安全地长期缓存（换版本 URL 也随之变化）。
  const url = `${assetBaseUrl()}${cleanPath}${version ? `?v=${version}` : ''}`;
  const expected = await expectedBytesFor(cleanPath);

  const cached = await idbGet(key);
  if (cached && cached.version === version && cached.buf && cached.buf.byteLength > 0) {
    if (expected === null || cached.buf.byteLength === expected) {
      onProgress?.({ loaded: cached.bytes || cached.buf.byteLength, total: cached.bytes || cached.buf.byteLength, fromCache: true });
      return cached.buf;
    }
    console.warn(`[assetStore] 丢弃异常的缓存资产 ${cleanPath}：缓存 ${cached.buf.byteLength} 字节 ≠ 清单 ${expected} 字节`);
    await idbDel(key);
  }

  const buf = await fetchWithProgress(url, onProgress);
  // 构建时加密的资源（模型/features.bin）在此处解密；未加密资源原样返回。
  // 解密后再存入 IndexedDB，后续从缓存读取即为明文，避免重复解密开销。
  const plain = isEncrypted(buf) ? decryptData(buf) : buf;
  if (expected !== null && plain.byteLength !== expected) {
    // 不写缓存：否则半截/错误内容会被当成有效资产一直用下去。
    throw new Error(
        `识别资产不完整：${cleanPath} 应为 ${expected} 字节，实际 ${plain.byteLength} 字节。` +
        `通常是部署时漏传了该文件，请重新部署站点后再试。`
    );
  }
  // 必须等写入完成再返回：调用方会把这个 ArrayBuffer transfer 给 Worker（transfer 后引用被清空），
  // 若 IndexedDB 序列化发生在 transfer 之后，缓存里就会存进一个空 buffer。
  await idbPut(key, { version, bytes: plain.byteLength, buf: plain });
  return plain;
}
