/**
 * 浏览器内本地识别器（IS_STATIC / 纯前端版使用，零后端）。
 *
 * 编排：清单 -> 模型(带进度/IndexedDB 缓存) -> Worker 建会话 -> 特征库 ->
 *       截图提特征 -> 全库匹配 + 当前地图白名单 -> (M3) OCR 名字融合 -> 结果。
 *
 * 输出结构刻意对齐 api.initBatch 的 BatchInitApiResponse（results/candidates/status/...），
 * 让 BatchRecognizerCard 无需区分本地/远程即可复用候选渲染、勾选与点亮逻辑。
 *
 * M2：模型/特征库按清单版本缓存（二次进入零下载）、后端自动降级、任务可取消、耗时统计。
 * M3：OCR 顶部懒加载，读到的名字参与候选融合（多形态/近似精灵更稳）。
 */
import axios from 'axios';
import { featureStore, FeatureEntry } from './featureStore';
import { buildWhitelist, isEntryInWhitelist, matchFeaturesEx } from './matcher';
import { splitPetFilename } from './petPath';
import { formatPetName } from '../../utils/petHelper';
import {
  hardwareThreads,
  isCrossOriginIsolated,
  loadAsset,
  loadManifest,
  preferredModels,
  type ModelTier,
  type RecognizerManifest,
} from './assetStore';
import { correctOcrText, parseCorrections, type Corrections } from './ocr';
import { fuseOcrFeat, getTopKMatches } from './textSim';
import type { SegmentBox } from './segments';
import type { PetItem } from '../../types';
import { storage } from '../storage';

export interface LocalCandidate {
  filename: string;
  score: number;
  view_url: string;
  match_path?: string;
  /** 候选来源：特征（图像）/ OCR（文字）/ 两者都命中。 */
  source?: 'feature' | 'ocr' | 'both';
  /** true 表示该候选不在当前地图白名单（仅作提示，用户仍可手动选择）。 */
  out_of_map?: boolean;
}

export interface LocalResultItem {
  index: number;
  status: 'matched' | 'unmatched';
  filename?: string;
  score?: number;
  view_url: string;
  reason?: string;
  candidates?: LocalCandidate[];
  /** 批量模式下该图位从整图中裁出的实际小图（data URI），用于与候选并排核对。 */
  crop_image?: string;
}

export interface LocalBatchResult {
  status: 'success';
  total_detected: number;
  results: LocalResultItem[];
  backend?: string;
}

export type ProgressPhase = 'manifest' | 'model' | 'session' | 'features' | 'ocr' | 'infer';

/**
 * 各阶段在总进度里的占比区间（Web 端用），按实测耗时量级划分：
 * 模型下载/读取、特征库加载、推理是三大块；每个阶段内部 0~100% 再线性映射进来，
 * 这样阶段切换时进度条是连续推进的，不会出现"先冲到 99% 再卡住"。
 */
export const WEB_PROGRESS_BANDS: Record<ProgressPhase, [number, number]> = {
  manifest: [0, 4],
  model: [4, 45],
  session: [45, 50],
  features: [50, 68],
  ocr: [68, 80],
  infer: [80, 100],
};

/** 把「阶段内百分比」映射成「总进度百分比」。 */
export function toGlobalProgress(phase: ProgressPhase, pct: number): number {
  const band = WEB_PROGRESS_BANDS[phase] || [0, 100];
  const clamped = Math.max(0, Math.min(100, pct || 0));
  return Math.round(band[0] + ((band[1] - band[0]) * clamped) / 100);
}
export type ProgressCb = (phase: ProgressPhase, pct: number, text?: string) => void;

export interface RecognizeOptions {
  /** 当前选中的地图序号（1/2/3），用于 OCR 候选按图收窄。 */
  stageNum?: number;
  /** 是否启用 OCR 名字融合（默认开；模型按需懒加载）。 */
  enableOcr?: boolean;
  /** 整页切图上限（批量识别最多处理几个图位，默认 12）。 */
  totalCount?: number;
  /** 识别进度（含模型加载阶段），批量时逐块推进。 */
  onProgress?: ProgressCb;
}

export const CANCELED = 'RECOGNITION_CANCELED';

interface PerfSample {
  backend: string;
  totalMs: number;
  featureMs: number;
  ocrMs: number;
  at: number;
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[idx] * 10) / 10;
}

function mb(bytes: number): string {
  return bytes > 0 ? `${(bytes / 1e6).toFixed(1)}MB` : '';
}

class LocalRecognizerClass {
  private worker: Worker | null = null;
  private reqSeq = 0;
  private pending = new Map<number, {
    resolve: (v: unknown) => void;
    reject: (e: Error) => void;
    onProgress?: (done: number, total: number) => void;
  }>();
  private backend = '';
  private threads = 1;
  private modelPath = '';
  private modelFromCache = false;
  private manifest: RecognizerManifest | null = null;
  private readyPromise: Promise<void> | null = null;
  private ocrReadyPromise: Promise<void> | null = null;
  private ocrChars: string[] = [];
  private corrections: Corrections | null = null;
  private cancelToken = 0;
  private perf: PerfSample[] = [];
  private readyMs = 0;
  private modelTier: ModelTier = 'auto';
  private lastBatch = { count: 0, mode: 'single' as 'single' | 'batch', boxes: [] as SegmentBox[] };

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('../../workers/recognition.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      const p = msg?.reqId != null ? this.pending.get(msg.reqId) : undefined;
      if (msg?.kind === 'recognize-progress') {
        p?.onProgress?.(msg.done, msg.total);
      } else if (msg?.kind === 'recognize-result') {
        if (p) {
          this.pending.delete(msg.reqId);
          this.backend = msg.backend || this.backend;
          p.resolve({
            feats: msg.feats as Float32Array,
            boxes: msg.boxes as SegmentBox[],
            mode: msg.mode,
            ms: msg.ms,
            dim: msg.dim,
          });
        }
      } else if (msg?.kind === 'feature') {
        if (p) {
          this.pending.delete(msg.reqId);
          this.backend = msg.backend || this.backend;
          p.resolve({ data: msg.data, ms: msg.ms });
        }
      } else if (msg?.kind === 'ocr-result') {
        if (p) {
          this.pending.delete(msg.reqId);
          p.resolve({ text: msg.text, items: msg.items || [], ms: msg.ms });
        }
      } else if (msg?.kind === 'feature-error') {
        if (p) {
          this.pending.delete(msg.reqId);
          p.reject(new Error(msg.message));
        }
      }
    };
    this.worker = worker;
    return worker;
  }

  /** 建会话（DINO）。 */
  private async initSession(modelBuffer: ArrayBuffer, onProgress?: ProgressCb): Promise<void> {
    onProgress?.('session', 0, '正在初始化识别模型');
    await new Promise<void>((resolve, reject) => {
      const worker = this.ensureWorker();
      const timer = window.setTimeout(() => reject(new Error('识别模型初始化超时（120s）')), 120000);
      const handler = (e: MessageEvent) => {
        if (e.data.kind === 'ready') {
          window.clearTimeout(timer);
          this.backend = e.data.backend || '';
          this.threads = e.data.threads || 1;
          worker.removeEventListener('message', handler);
          resolve();
        } else if (e.data.kind === 'init-error') {
          window.clearTimeout(timer);
          worker.removeEventListener('message', handler);
          reject(new Error(e.data.message));
        }
      };
      worker.addEventListener('message', handler);
      worker.postMessage({
        kind: 'init',
        modelBuffer,
        wasmPaths: `${import.meta.env.BASE_URL || '/'}wasm/`,
        threads: hardwareThreads(),
      }, [modelBuffer]);
    });
  }

  /**
   * 全局只做一次：读清单 -> 按能力挑模型（命中缓存则零下载）-> 建会话 -> 载特征库。
   * 任一模型文件 404/建会话失败会自动换下一个候选模型。
   */
  async ensureReady(onProgress?: ProgressCb): Promise<void> {
    if (this.readyPromise) return this.readyPromise;
    // 用户上次选择的模型档位（localStorage），首次识别时生效
    try {
      const saved = storage.getSetting<ModelTier | undefined>('webModelTier', undefined);
      if (saved === 'tiny' || saved === 'small' || saved === 'compat' || saved === 'auto') {
        this.modelTier = saved;
      }
    } catch {
      /* 读不到就用 auto */
    }
    this.readyPromise = this._init(onProgress);
    try {
      await this.readyPromise;
    } catch (e) {
      this.readyPromise = null; // 初始化失败允许下次重试
      throw e;
    }
  }

  private async _init(onProgress?: ProgressCb): Promise<void> {
    const t0 = performance.now();
    onProgress?.('manifest', 0, '正在准备识别资产');
    this.manifest = await loadManifest();
    const version = this.manifest?.version ?? 0;
    if (this.manifest?.scope) {
      console.info('[localRecognizer] 资产清单:', {
        scope: this.manifest.scope,
        version: this.manifest.version,
        features: this.manifest.features?.count,
        recommended: this.manifest.recommended,
        eval: this.manifest.eval,
      });
    }

    const candidates = preferredModels(this.manifest, this.modelTier);
    const webgpuPreferred = this.manifest?.recommended?.webgpu;
    let lastErr: unknown = null;
    let inited = false;
    for (const rel of candidates) {
      try {
        onProgress?.('model', 0, `正在加载识别模型（${rel.split('/').pop()}）`);
        let cached = false;
        const buf = await loadAsset(rel, version, (p) => {
          cached = p.fromCache;
          const pct = p.total ? Math.min(99, Math.round((p.loaded / p.total) * 100)) : 0;
          onProgress?.('model', pct, p.fromCache
              ? `正在读取本地缓存的识别模型（${mb(p.total)}）`
              : `正在下载识别模型 ${mb(p.loaded)}/${mb(p.total)}`);
        });
        await this.initSession(buf, onProgress);
        this.modelPath = rel;
        this.modelFromCache = cached;
        // 清单给 WebGPU 推荐的通常是 fp16：若实际只跑到 WASM（没有 WebGPU 可用），
        // 继续尝试下一个候选（fp32），避免"fp16 模型跑 WASM"这种又慢又可能掉精度的组合。
        if (webgpuPreferred && rel === webgpuPreferred && this.backend !== 'webgpu' && candidates.length > 1) {
          console.info('[localRecognizer] WebGPU 不可用，改用清单里的 WASM 推荐模型');
          continue;
        }
        inited = true;
        break;
      } catch (err) {
        lastErr = err;
        console.warn(`[localRecognizer] 模型 ${rel} 不可用，尝试下一个：`, err);
      }
    }
    if (!inited) {
      throw (lastErr instanceof Error ? lastErr : new Error('没有可用的识别模型，请检查 public-web/models 资产'));
    }

    onProgress?.('features', 0, '正在加载特征库');
    await featureStore.ensureLoaded(version, (p) => onProgress?.('features', p));
    this.readyMs = performance.now() - t0;
    onProgress?.('features', 100, '识别引擎就绪');
    console.info(`[localRecognizer] 就绪：backend=${this.backend} model=${this.modelPath} ` +
        `features=${featureStore.meta?.count} 耗时=${Math.round(this.readyMs)}ms ` +
        `（跨域隔离=${isCrossOriginIsolated()}）`);
  }

  /** M3：OCR 资产与模型按需加载（不点识别就不会下载）。 */
  async ensureOcrReady(onProgress?: ProgressCb): Promise<void> {
    if (this.ocrReadyPromise) return this.ocrReadyPromise;
    this.ocrReadyPromise = this._initOcr(onProgress);
    try {
      await this.ocrReadyPromise;
    } catch (e) {
      this.ocrReadyPromise = null;
      throw e;
    }
  }

  private async _initOcr(onProgress?: ProgressCb): Promise<void> {
    const version = this.manifest?.version ?? 0;
    const ocr = this.manifest?.ocr || {};
    const det = ocr.det?.file;
    const rec = ocr.rec?.file;
    const keysFile = ocr.keys?.file || 'data/ocr_keys.json';
    if (!det || !rec) throw new Error('未找到 OCR 模型资产（请先运行 tools/export_web_recognizer.py）');

    onProgress?.('ocr', 0, '正在加载 OCR 模型');
    const [detBuf, recBuf, keysRes] = await Promise.all([
      loadAsset(det, version, (p) => onProgress?.('ocr', p.total ? Math.min(50, Math.round((p.loaded / p.total) * 50)) : 0,
          `正在加载 OCR 检测模型 ${mb(p.loaded)}/${mb(p.total)}`)),
      loadAsset(rec, version, (p) => onProgress?.('ocr', p.total ? Math.min(90, 50 + Math.round((p.loaded / p.total) * 40)) : 50,
          `正在加载 OCR 识别模型 ${mb(p.loaded)}/${mb(p.total)}`)),
      axios.get<{ chars: string[] }>(`${import.meta.env.BASE_URL || '/'}${keysFile}`, { timeout: 20000 }),
    ]);
    this.ocrChars = keysRes.data?.chars || [];
    if (!this.ocrChars.length) throw new Error('OCR 字符表为空');

    const correctionsFile = ocr.corrections?.file || 'data/ocr_corrections.json';
    try {
      const res = await axios.get(`${import.meta.env.BASE_URL || '/'}${correctionsFile}`, { timeout: 10000 });
      this.corrections = parseCorrections(res.data);
    } catch {
      this.corrections = null;
    }

    await new Promise<void>((resolve, reject) => {
      const worker = this.ensureWorker();
      const timer = window.setTimeout(() => reject(new Error('OCR 模型初始化超时（120s）')), 120000);
      const handler = (e: MessageEvent) => {
        if (e.data.kind === 'ocr-ready') {
          window.clearTimeout(timer);
          worker.removeEventListener('message', handler);
          resolve();
        } else if (e.data.kind === 'ocr-init-error') {
          window.clearTimeout(timer);
          worker.removeEventListener('message', handler);
          reject(new Error(e.data.message));
        }
      };
      worker.addEventListener('message', handler);
      worker.postMessage({ kind: 'ocr-init', detBuffer: detBuf, recBuffer: recBuf, chars: this.ocrChars },
          [detBuf, recBuf]);
    });
    onProgress?.('ocr', 100, 'OCR 就绪');
  }

  /** 让进行中的识别作废（用户换图/取消时调用），旧任务的结果会被丢弃。 */
  cancelPending(): void {
    this.cancelToken++;
  }

  /** 切换模型档位（体积/精度权衡）；已建会话会在下次识别时按新档位重建。 */
  setModelTier(tier: ModelTier): void {
    if (tier === this.modelTier) return;
    this.modelTier = tier;
    this.readyPromise = null;   // 强制重新按新档位加载模型
    this.ocrReadyPromise = null; // OCR 会话挂在同一个 worker 上，重建时一起重置
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
    try {
      storage.setSetting('webModelTier', tier);
    } catch {
      /* localStorage 不可用时忽略 */
    }
  }

  getModelTier(): ModelTier {
    return this.modelTier;
  }

  /** 上一次切图结果（批量识别的图位数与模式），供界面提示「已切分 N 个图位」。 */
  getLastBatchInfo() {
    return this.lastBatch;
  }

  private isCanceled(token: number): boolean {
    return token !== this.cancelToken;
  }

  getBackend(): string {
    return this.backend;
  }

  getModelPath(): string {
    return this.modelPath;
  }

  /** 本次模型是命中 IndexedDB 缓存还是重新下载的（Web 端信息条用）。 */
  isModelFromCache(): boolean {
    return this.modelFromCache;
  }

  getManifest(): RecognizerManifest | null {
    return this.manifest;
  }

  /** 耗时统计（P50/P95），M2 验收用。 */
  getPerfSummary() {
    const totals = this.perf.map((p) => p.totalMs);
    return {
      samples: this.perf.length,
      backend: this.backend,
      threads: this.threads,
      readyMs: Math.round(this.readyMs),
      totalP50: percentile(totals, 50),
      totalP95: percentile(totals, 95),
      last: this.perf[this.perf.length - 1] || null,
    };
  }

  /** 整页识别：切图 + 逐块特征（都在 Worker 内完成，onChunk 为图位级进度）。 */
  private recognizeBitmap(
      image: Blob,
      totalCount: number,
      nameItems: { text: string; cx: number; cy: number; nw: number; nh: number }[],
      onChunk?: (done: number, total: number) => void
  ): Promise<{ feats: Float32Array; boxes: SegmentBox[]; mode: 'single' | 'batch'; ms: number; dim: number }> {
    return new Promise((resolve, reject) => {
      createImageBitmap(image)
          .then((bitmap) => {
            const reqId = ++this.reqSeq;
            this.pending.set(reqId, {
              resolve: resolve as (v: unknown) => void,
              reject,
              onProgress: onChunk,
            });
            this.ensureWorker().postMessage({ kind: 'recognize', reqId, bitmap, totalCount, nameItems }, [bitmap]);
          })
          .catch(reject);
    });
  }

  private runOcr(image: Blob): Promise<{
    text: string;
    items: { text: string; cx: number; cy: number; nw: number; nh: number }[];
    ms: number;
  }> {
    return new Promise((resolve, reject) => {
      createImageBitmap(image)
          .then((bitmap) => {
            const reqId = ++this.reqSeq;
            this.pending.set(reqId, { resolve: resolve as (v: unknown) => void, reject });
            this.ensureWorker().postMessage({ kind: 'ocr', reqId, bitmap }, [bitmap]);
          })
          .catch(reject);
    });
  }

  /** 把切出来的图位裁成 data URI，供候选与截图并排核对（与桌面版 crop_image 等价）。 */
  private async cropDataUri(image: Blob, box: SegmentBox): Promise<string | undefined> {
    if (typeof document === 'undefined') return undefined;
    try {
      const bitmap = await createImageBitmap(image, box.x, box.y, box.w, box.h);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return undefined;
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close?.();
      return canvas.toDataURL('image/png');
    } catch {
      return undefined;
    }
  }

  /** 当前地图的精灵展示名（供 OCR 文本模糊匹配）与「展示名 -> 数据集文件名」映射。 */
  private mapNameIndex(stageNum: number | undefined, whitelisted: (e: FeatureEntry) => boolean) {
    const names: string[] = [];
    const fileOf = new Map<string, string>();
    const entries = featureStore.meta?.entries || [];
    for (const e of entries) {
      if (e.shot) continue;
      if (!whitelisted(e)) continue;
      if (stageNum && e.maps && e.maps.length && !e.maps.includes(stageNum)) continue;
      const display = e.name.replace(/_shot$/i, '');
      if (!display) continue;
      if (!fileOf.has(display)) fileOf.set(display, e.path);
      names.push(display);
    }
    return { names, fileOf };
  }

  private fileOfName(fileOf: Map<string, string>, displayName: string, fallback?: string): string {
    if (fileOf.has(displayName)) return fileOf.get(displayName) as string;
    if (fallback) return fallback;
    return `${displayName}.png`;
  }

  /**
   * 截图识别（单图 / 整页批量统一入口）。
   *
   * 先切图（1:1 复刻后端 segment_icons）：切出 >=2 个图位就逐位出候选（批量，等价 /init_batch）；
   * 切不出多块时按整图单图处理（等价 /predict）。返回结构与 api.initBatch 同构。
   */
  async recognizeSingle(
      image: Blob,
      targetMapPets: PetItem[],
      threshold: number,
      topK: number,
      options: RecognizeOptions = {}
  ): Promise<LocalBatchResult> {
    const token = ++this.cancelToken;
    const t0 = performance.now();
    const onProgress = options.onProgress;
    await this.ensureReady(onProgress);
    if (this.isCanceled(token)) throw new Error(CANCELED);

    // OCR 先跑：既提供「最底部名字行」文本，又给切图提供名字锚点（复刻桌面端 /init_batch 的顺序）
    let ocrText = '';
    let ocrItems: { text: string }[] = [];
    let anchorItems: { text: string; cx: number; cy: number; nw: number; nh: number }[] = [];
    let ocrMs = 0;
    if (options.enableOcr !== false) {
      try {
        await this.ensureOcrReady(onProgress);
        const ocrStart = performance.now();
        const res = await this.runOcr(image);
        ocrMs = performance.now() - ocrStart;
        ocrText = correctOcrText(res.text || '', this.corrections);
        ocrItems = (res.items || []).map((it) => ({ text: correctOcrText(it.text, this.corrections) }));
        anchorItems = (res.items || []).map((it) => ({
          text: correctOcrText(it.text, this.corrections),
          cx: it.cx,
          cy: it.cy,
          nw: it.nw,
          nh: it.nh,
        }));
        if (this.isCanceled(token)) throw new Error(CANCELED);
      } catch (err) {
        // OCR 是增强项：失败只记日志，绝不影响纯特征识别结果
        if ((err as Error)?.message === CANCELED) throw err;
        console.warn('[localRecognizer] OCR 增强不可用，已跳过：', err);
      }
    }

    const featureStart = performance.now();
    const { feats, boxes, mode, dim } = await this.recognizeBitmap(
        image,
        options.totalCount ?? 12,
        anchorItems,
        (done, total) => onProgress?.('infer', total ? Math.round((done / total) * 100) : 0,
            `正在识别第 ${done}/${total} 个图位`)
    );
    const featureMs = performance.now() - featureStart;
    if (this.isCanceled(token)) throw new Error(CANCELED);

    const wl = buildWhitelist(targetMapPets);
    const slots = boxes.length;
    this.lastBatch = { count: slots, mode, boxes };

    const results: LocalResultItem[] = [];
    for (let i = 0; i < slots; i++) {
      if (this.isCanceled(token)) throw new Error(CANCELED);
      const query = feats.subarray(i * dim, (i + 1) * dim);
      results.push(await this.buildSlotResult({
        index: i,
        query,
        whitelist: wl,
        threshold,
        topK,
        stageNum: options.stageNum,
        ocrText: mode === 'single' ? ocrText : (ocrItems[i]?.text || ''),
        cropImage: mode === 'batch' ? await this.cropDataUri(image, boxes[i]) : undefined,
      }));
    }

    const totalMs = performance.now() - t0;
    this.perf.push({ backend: this.backend, totalMs, featureMs, ocrMs, at: Date.now() });
    if (this.perf.length > 50) this.perf.shift();
    const matched = results.filter((r) => r.status === 'matched').length;
    console.info(`[localRecognizer] ${mode === 'single' ? '单图' : `批量 ${slots} 图位`}识别完成 ` +
        `${Math.round(totalMs)}ms（特征+切图 ${Math.round(featureMs)}ms / OCR ${Math.round(ocrMs)}ms）` +
        `backend=${this.backend} 命中=${matched}/${slots}` + (ocrText ? ` OCR="${ocrText}"` : ''));

    return {
      status: 'success',
      total_detected: slots,
      backend: this.backend,
      results,
    };
  }

  /** 单个图位：特征候选 + （可选）OCR 名字候选融合，产出与后端同构的一条结果。 */
  private async buildSlotResult(args: {
    index: number;
    query: Float32Array;
    whitelist: ReturnType<typeof buildWhitelist>;
    threshold: number;
    topK: number;
    stageNum?: number;
    ocrText: string;
    cropImage?: string;
  }): Promise<LocalResultItem> {
    const { index, query, whitelist: wl, threshold, topK, stageNum, ocrText, cropImage } = args;
    const outcome = matchFeaturesEx(query, wl, threshold, topK);

    const merged = new Map<string, LocalCandidate>();
    for (const c of outcome.candidates) {
      merged.set(c.filename, { ...c, view_url: '', source: 'feature' });
    }

    if (ocrText) {
      const { names, fileOf } = this.mapNameIndex(stageNum, (e) => isEntryInWhitelist(e, wl));
      const rawMatches = getTopKMatches(ocrText, names, Math.max(topK * 2, 6)).filter((m) => m.score > 0.1);
      const featForFusion = Array.from(merged.values()).map((c) => ({
        name: splitPetFilename(c.filename)?.name || c.filename,
        score: c.score,
      }));
      for (const m of fuseOcrFeat(rawMatches, featForFusion)) {
        const filename = this.fileOfName(fileOf, m.name);
        const exist = merged.get(filename);
        if (!exist) {
          merged.set(filename, {
            filename,
            match_path: filename,
            score: m.score,
            view_url: '',
            source: 'ocr',
          });
        } else if (m.score > exist.score) {
          exist.score = m.score;
          exist.source = exist.source === 'feature' ? 'both' : exist.source;
        } else {
          exist.source = 'both';
        }
      }
    }

    const list = Array.from(merged.values()).sort((a, b) => b.score - a.score).slice(0, topK);
    if (!list.length) {
      const hint = outcome.bestGlobal
          ? `当前地图（map${stageNum ?? '?'}）没有可信候选，最相近的是 ${formatPetName(outcome.bestGlobal.candidate.filename)}` +
            `（${(outcome.bestGlobal.candidate.score * 100).toFixed(1)}%，不在本图白名单）`
          : `未找到匹配程度足够高的精灵（阈值 ${threshold}）`;
      return {
        index,
        status: 'unmatched',
        view_url: '',
        reason: ocrText ? `${hint}；OCR 读到「${ocrText}」` : hint,
        crop_image: cropImage,
        // 不在白名单但确实高分命中的候选也回传，用户可点击手动选择
        candidates: outcome.outOfMap.map((c) => ({
          filename: c.filename,
          score: c.score,
          view_url: '',
          match_path: c.match_path,
          source: 'feature' as const,
          out_of_map: true,
        })),
      };
    }

    const top = list[0];
    return {
      index,
      status: 'matched',
      filename: top.filename,
      score: top.score,
      view_url: '',
      crop_image: cropImage,
      candidates: list.map((c) => ({
        filename: c.filename,
        score: c.score,
        view_url: '',
        match_path: c.match_path || c.filename,
        source: c.source,
        out_of_map: c.out_of_map,
      })),
    };
  }
}

export const localRecognizer = new LocalRecognizerClass();
