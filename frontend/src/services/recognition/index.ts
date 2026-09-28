/**
 * 识别统一入口：
 *  - 纯前端版（IS_STATIC，--mode web）：走浏览器内 LocalRecognizer，零后端、零网络识别请求；
 *  - 桌面版（默认）：仍走 api.initBatch（Flask），链路完全不变。
 *    PC 端同样有进度条：前端生成 task_id，后端按阶段写进度快照，前端轮询 /api/recog_progress。
 *
 * 返回结构统一为 { data: BatchInitApiResponse(同构), isOfflineMock }，组件无需感知差异。
 */
import { IS_STATIC } from '../staticMode';
import { api } from '../api';
import {
  CANCELED,
  localRecognizer,
  toGlobalProgress,
  ProgressCb,
  RecognizeOptions,
} from './localRecognizer';
import { hasWebGPU, isAssetCached, loadManifest, type ModelTier } from './assetStore';
import type { BatchInitApiResponse, PetItem } from '../../types';

export async function recognizeImage(
    image: File | Blob,
    stageNum: number,
    threshold: number,
    topK: number,
    trialKey: string,
    targetMapPets: PetItem[],
    onProgress?: ProgressCb,
    options?: RecognizeOptions
): Promise<{ data: BatchInitApiResponse; isOfflineMock: boolean }> {
  if (IS_STATIC) {
    const local = await localRecognizer.recognizeSingle(image, targetMapPets || [], threshold, topK, {
      stageNum,
      // 阶段内百分比 -> 总进度百分比（0~100 单调），组件拿到的就是可以直接画的值
      onProgress: onProgress
          ? (phase, pct, text) => onProgress(phase, toGlobalProgress(phase, pct), text)
          : undefined,
      ...(options || {}),
    });
    return { data: local as unknown as BatchInitApiResponse, isOfflineMock: false };
  }
  return await runWithDesktopProgress(onProgress, async (taskId) =>
      api.initBatch(image, stageNum, threshold, topK, trialKey, taskId));
}

/**
 * PC 端：给后端请求带上 task_id，同时按 150ms 轮询进度快照，喂给同一套 onProgress 回调。
 * 后端/接口不可用时静默降级为「无进度条」，绝不影响识别本身。
 * 注意：本机回环请求开销很低，轮询快一点才能抓到「OCR → 批量特征 → 逐图位」之间的过渡。
 */
async function runWithDesktopProgress<T>(
    onProgress: ProgressCb | undefined,
    run: (taskId: string) => Promise<T>
): Promise<T> {
  const taskId = `pc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  let timer: number | null = null;
  let lastText = '';
  if (onProgress && typeof window !== 'undefined') {
    onProgress('session', 0, '正在准备识别');
    timer = window.setInterval(() => {
      api.getRecogProgress(taskId)
          .then((snap) => {
            if (!snap) return;
            const text = snap.text || '正在识别';
            if (text === lastText && snap.pct === 0) return;
            lastText = text;
            onProgress(snap.phase === 'ocr' ? 'ocr' : 'infer', snap.pct, text);
          })
          .catch(() => {
            /* 轮询失败就当没有进度条 */
          });
    }, 150);
  }
  try {
    return await run(taskId);
  } finally {
    if (timer !== null) window.clearInterval(timer);
  }
}

export interface ModelOption {
  tier: ModelTier;
  label: string;
  desc: string;
  /** 相对 BASE_URL 的模型路径；清单里没有该档位时为 null（不可选）。 */
  path: string | null;
  bytes: number;
  /** 构建期量化评测结论（Top-1 与 fp32 一致率），没有评测则为 null。 */
  top1Agreement: number | null;
  /** 该档位模型是否已经下载到本地（IndexedDB），设置面板里显示「已下载」。 */
  cached: boolean;
}

const TIER_LABELS: { tier: ModelTier; label: string; desc: string; keys: string[] }[] = [
  { tier: 'auto', label: '自动（推荐）', desc: '默认用 fp16（体积小、精度与 fp32 一致）', keys: [] },
  { tier: 'small', label: '小体积 fp16', desc: '约 42MB，精度与 fp32 一致（需 WebGPU）', keys: ['fp16'] },
  { tier: 'compat', label: '兼容 fp32', desc: '约 84MB，任何浏览器都能跑', keys: ['fp32'] },
  { tier: 'tiny', label: '极省 int8', desc: '约 24MB，Top-1 一致率略降（构建期实测）', keys: ['int8'] },
];

/** 识别参数面板用：可选的模型档位 + 体积 + 评测结论（读清单，不触发模型下载）。 */
export async function getModelOptions(): Promise<ModelOption[]> {
  if (!IS_STATIC) return [];
  const manifest = await loadManifest();
  const assets = manifest?.assets || [];
  const sizeOf = (rel?: string | null) => {
    if (!rel) return 0;
    return assets.find((a) => a.path === rel)?.bytes || 0;
  };
  const version = manifest?.version ?? 0;
  return Promise.all(TIER_LABELS.map(async (t) => {
    const paths = t.keys.map((k) => manifest?.models?.[k]).filter((v): v is string => !!v);
    const evalKey = t.keys[0];
    const ev = evalKey ? manifest?.eval?.[evalKey] : undefined;
    // 「自动」档没有固定文件：WebGPU 与 WASM 两个推荐模型任意一个已缓存就算已下载
    const cachedPaths = t.tier === 'auto'
        ? [manifest?.recommended?.webgpu, manifest?.recommended?.wasm].filter((v): v is string => !!v)
        : paths.slice(0, 1);
    const cachedFlags = await Promise.all(cachedPaths.map((p) => isAssetCached(p, version)));
    return {
      tier: t.tier,
      label: t.label,
      desc: t.desc,
      path: paths[0] || null,
      bytes: sizeOf(paths[0]),
      top1Agreement: typeof ev?.top1_agreement === 'number' ? ev.top1_agreement : null,
      cached: cachedFlags.some(Boolean),
    };
  }));
}

/** 识别完成后刷新「已下载」状态（刚下完的档位要立刻显示成已下载）。 */
export async function refreshModelCacheState(): Promise<ModelOption[]> {
  return getModelOptions();
}

/** 切换模型档位（体积/精度）。下次识别会按新档位加载（已缓存则不用重下）。 */
export function setModelTier(tier: ModelTier): void {
  if (IS_STATIC) localRecognizer.setModelTier(tier);
}

export function getModelTier(): ModelTier {
  return localRecognizer.getModelTier();
}

/** 上一次切图结果：单图还是批量、切出几个图位。 */
export function getLastBatchInfo() {
  return IS_STATIC ? localRecognizer.getLastBatchInfo() : null;
}

/** 纯前端版：取消进行中的识别（用户换图/点取消时调用）。桌面版为空操作。 */
export function cancelLocalRecognition(): void {
  if (IS_STATIC) localRecognizer.cancelPending();
}

/** 纯前端版：区分「被取消」与真实失败，组件据此静默忽略。 */
export function isRecognitionCanceled(err: unknown): boolean {
  return (err as Error)?.message === CANCELED;
}

/** 纯前端版：耗时/后端统计（M2 验收：P50/P95 与后端降级情况）。 */
export function getRecognizerPerf() {
  return IS_STATIC ? localRecognizer.getPerfSummary() : null;
}

/** 纯前端版：当前后端与模型文件名，用于界面上的小字提示/排查。 */
export function getRecognizerInfo() {
  return IS_STATIC
      ? { backend: localRecognizer.getBackend(), model: localRecognizer.getModelPath(),
          manifest: localRecognizer.getManifest(), fromCache: localRecognizer.isModelFromCache() }
      : null;
}

/** 纯前端版可在用户选图前预热（下载模型/建会话）；桌面版为空操作。 */
export async function warmupRecognizer(onProgress?: ProgressCb): Promise<void> {
  if (IS_STATIC) await localRecognizer.ensureReady(onProgress);
}

export { localRecognizer } from './localRecognizer';
export type { ProgressCb, RecognizeOptions } from './localRecognizer';
/** 纯前端版是否具备 WebGPU（不具备时首页不显示识别模块）。 */
export { hasWebGPU } from './assetStore';
