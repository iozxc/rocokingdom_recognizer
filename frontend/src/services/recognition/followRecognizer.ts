/**
 * 纯前端版「跟随识别」入口。
 *
 * 链路：Screen Capture API 抓游戏窗口一帧 -> onnxruntime-web 在 Worker 里
 *       YOLO 切槽位 + 标题/名字 rec-only OCR + 头像位 DINO 提特征
 *       -> 主线程判关卡 + 按地图白名单做余弦检索 -> 返回与桌面端同构的结果。
 *
 * 与桌面版的差异（产品形态上的必然折损，不是实现偷懒）：
 *  - 浏览器不能自动定位/截取别的程序窗口，必须由用户在共享选择器里选中游戏窗口，
 *    且每次刷新页面后要重新选一次；
 *  - 单次耗时更长（WASM/WebGPU 相对 native onnxruntime 有差距），但只影响等待时间。
 *
 * 因此本模块只负责「抓帧 + 识别 + 结果整形」，选择窗口/状态展示交给界面层。
 */
import { screenCapture } from './capture';
import { localRecognizer, CANCELED, type ProgressCb } from './localRecognizer';
import { getTrialOrDanger } from './trialConfig';

export interface FollowCandidate {
  filename: string;
  score: number;
}

export interface FollowSlotResult {
  index: number;
  status: 'matched' | 'unmatched';
  /** 最优候选文件名（unmatched 时为空串） */
  filename: string;
  score: number;
  reason?: string;
  /** 该槽位实际检出的头像裁剪图（object URL，可直接给 <img src>；用完需 revoke） */
  cropUrl: string | null;
  candidates: FollowCandidate[];
}

export interface FollowRecognizeMeta {
  /** 标题 OCR 原文（纠错后） */
  titleText: string;
  /** true = 关卡来自标题 OCR，false = 用了钉住关卡或默认值 */
  stageFromTitle: boolean;
  /** 各阶段耗时（ms） */
  ms: { total: number; yolo: number; title: number; names: number; dino: number; match: number };
  backend: string;
  /** 检出数量：标题 / 头像 / 名字 */
  counts: { title: number; item: number; name: number };
  /** true = 画面与上次完全一致，直接沿用了上次结果（没有重新推理） */
  reused?: boolean;
}

export interface FollowRecognizeResult {
  code: 200;
  stage_num: number;
  results: FollowSlotResult[];
  /** 3×384 的 L2 归一化头像特征（缺位全 0），供自动模式缓存战斗头像比对 */
  feats: Float32Array;
  meta: FollowRecognizeMeta;
}

/** 抓帧失败（未选窗口 / 共享已结束）时抛出，界面据此提示。 */
export class FollowCaptureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FollowCaptureError';
  }
}

export interface WebFollowOptions {
  /** 钉住的关卡；null = 按标题 OCR 自动判定 */
  stageNum: number | null;
  trialKey?: string;
  threshold?: number;
  /** 候选数量上限（桌面端跟随识别固定 36） */
  topK?: number;
  /** 版面检测输入边长（不传用清单默认值 1280；960 更快、对小窗口更稳） */
  imgsz?: number;
  onProgress?: ProgressCb;
}

/** 上次结果里创建的 object URL，下次识别前统一回收，避免长时间开窗后内存堆积。 */
let lastCropUrls: string[] = [];

/**
 * 上一次识别结果 + 其对应的画面指纹。
 *
 * 画面逐像素没变、且识别参数相同时（用户手滑点了两次、或没推进游戏就再点一次），
 * 直接沿用结果 —— 单次识别在浏览器里要好几秒，不该为同一张图重复付这个代价。
 * 指纹来自 capture 模块的 8x8 灰度采样，仅用于判「有没有变」，不参与识别。
 */
let lastOutcome: {
  key: string;
  frameSignature: string;
  result: FollowRecognizeResult;
} | null = null;

function revokeLastCropUrls(): void {
  for (const url of lastCropUrls) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    }
  }
  lastCropUrls = [];
}

/**
 * 跟随识别一次。
 *
 * 注意：**调用方必须保证此前已经通过用户手势调过 screenCapture.start()**，
 * 因为 getDisplayMedia 不能在非手势上下文里调用。
 */
export async function webFollowRecognize(options: WebFollowOptions): Promise<FollowRecognizeResult> {
  const trialKey = options.trialKey || 'grass';
  const trial = getTrialOrDanger(trialKey);

  if (!screenCapture.isActive()) {
    throw new FollowCaptureError('还没有选择游戏窗口，请先点「选择游戏窗口」并选中《洛克王国：世界》');
  }

  const cacheKey = [
    trialKey,
    options.stageNum ?? 'auto',
    options.imgsz ?? 'auto',
    options.threshold ?? 0.25,
    options.topK ?? 36,
  ].join('|');

  // 抓帧：拿到按下识别那一刻的画面（含「画面没更新」的判定）
  let frame;
  try {
    frame = await screenCapture.grab();
  } catch (err) {
    throw new FollowCaptureError((err as Error)?.message || '抓取游戏画面失败');
  }

  // 画面与上次完全一致：直接用上次结果，不做任何推理
  if (frame.repeated && lastOutcome && lastOutcome.key === cacheKey
      && lastOutcome.frameSignature === frame.signature) {
    frame.bitmap.close?.();
    return {
      ...lastOutcome.result,
      meta: { ...lastOutcome.result.meta, reused: true },
    };
  }

  const t0 = performance.now();
  const outcome = await localRecognizer.recognizeFollow(frame.bitmap, {
    stageNum: options.stageNum,
    trialKey,
    threshold: options.threshold,
    topK: options.topK,
    imgsz: options.imgsz,
    onProgress: options.onProgress,
  });

  revokeLastCropUrls();
  const cropUrls = outcome.cropBlobs.map((b) => {
    if (!b) return null;
    const url = URL.createObjectURL(b);
    lastCropUrls.push(url);
    return url;
  });

  const results: FollowSlotResult[] = outcome.results.map((item, i) => {
    const candidates: FollowCandidate[] = (item.candidates || []).map((c) => ({
      filename: c.filename,
      score: c.score,
    }));
    return {
      index: i,
      status: item.status,
      filename: item.filename || '',
      score: item.score ?? 0,
      reason: item.reason,
      cropUrl: cropUrls[i] ?? null,
      candidates,
    };
  });

  const allMs = performance.now() - t0;
  const result: FollowRecognizeResult = {
    code: 200,
    stage_num: outcome.stageNum,
    results,
    feats: outcome.feats,
    meta: {
      titleText: outcome.titleText,
      stageFromTitle: outcome.stageFromTitle,
      ms: { ...outcome.ms, total: allMs },
      backend: outcome.backend,
      counts: outcome.sections.counts,
    },
  };
  lastOutcome = { key: cacheKey, frameSignature: frame.signature, result };
  return result;
}

/** 释放上一次结果里的裁剪图 URL（关窗/离开页面时调用）。 */
export function releaseFollowAssets(): void {
  revokeLastCropUrls();
  lastOutcome = null;
}

export { CANCELED };
