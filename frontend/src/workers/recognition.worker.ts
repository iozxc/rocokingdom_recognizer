/**
 * 浏览器内识别 Worker：DINO 特征 + PP-OCRv4 文字（纯前端版专用）。
 *
 * DINO 链路严格对齐 core/vision/recognizer.py：
 *  - RGB；Canvas 双线性缩放到 518×518（等价 cv2.resize INTER_LINEAR，直接拉伸不保持比例）
 *  - /255；ImageNet mean/std 归一化；HWC -> CHW，得到 [1,3,518,518] float32
 *  - 输出 flatten 后 L2 归一化得到 query（384 维）
 *
 * M2 降级链（同一份 worker 按能力自动选）：
 *   WebGPU -> 多线程 WASM（需跨域隔离 COOP/COEP）-> 单线程 WASM
 *
 * M3 OCR：det(float 概率图) -> dbPostprocess(连通域+外扩) -> rec(48 高等比) -> CTC greedy，
 * 全部在 Worker 内完成，主线程只收最终文本，UI 不卡顿。
 *
 * 模型字节由主线程从 IndexedDB 缓存取好后 transfer 进来，worker 内不再联网。
 */
// 用 webgpu 入口（wasm + WebGPU 两套 EP）：默认入口 ort.bundle 里没有 JSEP，
// 会导致 executionProviders:['webgpu'] 必然失败、永远退回 WASM。
import * as ort from 'onnxruntime-web/webgpu';
import {
  DET_CONFIG,
  detPreprocess,
  detResizeSize,
  dbPostprocess,
  recPreprocess,
  ctcDecode,
  pickBottomItems,
  pickBottomText,
  type OcrBlock,
} from '../services/recognition/ocr';
import {
  hasCjk,
  segmentIcons,
  segmentIconsByNameAnchors,
  segmentLooksBad,
  type NameAnchorItem,
  type SegmentBox,
} from '../services/recognition/segments';

const INPUT_SIZE = 518;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];
const MAX_OCR_BOXES = 16;
/** 批量特征前向的分块大小（每张 518×518 NCHW 约 3.2MB，分块跑避免一次性吃满内存）。 */
const FEATURE_CHUNK = 4;

type InitMsg = { kind: 'init'; modelBuffer: ArrayBuffer; wasmPaths: string; threads?: number };
type ExtractMsg = { kind: 'extract'; reqId: number; bitmap: ImageBitmap };
type OcrInitMsg = { kind: 'ocr-init'; detBuffer: ArrayBuffer; recBuffer: ArrayBuffer; chars: string[] };
type OcrMsg = { kind: 'ocr'; reqId: number; bitmap: ImageBitmap };
type RecognizeMsg = {
  kind: 'recognize';
  reqId: number;
  bitmap: ImageBitmap;
  totalCount?: number;
  /** OCR 底行名字项（有则参与「名字锚定」兜底，和桌面端 /init_batch 一致）。 */
  nameItems?: NameAnchorItem[];
};
type InMsg = InitMsg | ExtractMsg | OcrInitMsg | OcrMsg | RecognizeMsg;

let dinoSession: ort.InferenceSession | null = null;
let dinoInput = 'batch';
let backend = 'wasm';
let wasmPathsGlobal = '/wasm/';
let detSession: ort.InferenceSession | null = null;
let recSession: ort.InferenceSession | null = null;
let ocrChars: string[] = [];

const workerScope = self as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((ev: MessageEvent) => void) | null;
  crossOriginIsolated?: boolean;
};

function runtimeEps(): string[] {
  const eps: string[] = [];
  if (typeof navigator !== 'undefined' && (navigator as Navigator & { gpu?: unknown }).gpu) eps.push('webgpu');
  eps.push('wasm');
  return eps;
}

async function createOrtSession(buffer: ArrayBuffer, label: string): Promise<ort.InferenceSession> {
  ort.env.wasm.wasmPaths = wasmPathsGlobal;
  ort.env.wasm.simd = true;
  let lastErr: unknown = null;
  for (const eps of [runtimeEps(), ['wasm']]) {
    try {
      return await ort.InferenceSession.create(buffer.slice(0), {
        executionProviders: eps,
        graphOptimizationLevel: 'all',
      } as ort.InferenceSession.SessionOptions);
    } catch (err) {
      lastErr = err;
      console.warn(`[recognition.worker] ${label} 建会话失败（${eps[0]}），继续降级：`, err);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** DINO 会话：WebGPU -> 多线程 WASM -> 单线程 WASM。 */
async function createDinoSession(buffer: ArrayBuffer, wantThreads: number): Promise<void> {
  ort.env.wasm.wasmPaths = wasmPathsGlobal;
  const isolated = workerScope.crossOriginIsolated === true;
  const threads = isolated ? Math.max(1, wantThreads || 1) : 1;
  ort.env.wasm.numThreads = threads;

  const attempts: { label: string; eps: string[]; threads: number }[] = [];
  if (typeof navigator !== 'undefined' && (navigator as Navigator & { gpu?: unknown }).gpu) {
    // webgpu 在前、wasm 兜底：int8 的 MatMulInteger 之类算子 WebGPU 不支持时，
    // 由 ORT 自动把那些节点分给 wasm，而不是整场会话失败。
    attempts.push({ label: 'webgpu', eps: ['webgpu', 'wasm'], threads: 1 });
  }
  if (threads > 1) attempts.push({ label: 'wasm-threads', eps: ['wasm'], threads });
  attempts.push({ label: 'wasm', eps: ['wasm'], threads: 1 });

  let lastErr: unknown = null;
  for (const attempt of attempts) {
    try {
      // 会话创建会消费 ArrayBuffer，失败重试必须用副本
      dinoSession = await createOrtSession(buffer.slice(0), `dino/${attempt.label}`);
      if (attempt.threads !== ort.env.wasm.numThreads) {
        ort.env.wasm.numThreads = attempt.threads;
        dinoSession = await createOrtSession(buffer.slice(0), `dino/${attempt.label}#retry`);
      }
      dinoInput = dinoSession.inputNames[0] || 'batch';
      backend = attempt.label;
      return;
    } catch (err) {
      lastErr = err;
      console.warn(`[recognition.worker] ${attempt.label} 不可用，尝试下一个后端：`, err);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** DINO 预处理：与后端一致的 518×518 拉伸 + ImageNet 归一化，NCHW。 */
function preprocessDino(bitmap: ImageBitmap): Float32Array {
  const canvas = new OffscreenCanvas(INPUT_SIZE, INPUT_SIZE);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('无法创建 2D 画布上下文');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'low'; // 标准双线性，避免 high 走高阶滤波导致与 cv2 偏差
  ctx.clearRect(0, 0, INPUT_SIZE, INPUT_SIZE);
  ctx.drawImage(bitmap, 0, 0, INPUT_SIZE, INPUT_SIZE);
  const imgData = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data;

  const px = INPUT_SIZE * INPUT_SIZE;
  const out = new Float32Array(3 * px);
  for (let p = 0; p < px; p++) {
    const s = p * 4;
    out[0 * px + p] = (imgData[s] / 255 - MEAN[0]) / STD[0];
    out[1 * px + p] = (imgData[s + 1] / 255 - MEAN[1]) / STD[1];
    out[2 * px + p] = (imgData[s + 2] / 255 - MEAN[2]) / STD[2];
  }
  return out;
}

async function extractFeature(bitmap: ImageBitmap): Promise<{ feat: Float32Array; ms: number }> {
  if (!dinoSession) throw new Error('识别模型尚未初始化完成');
  const t0 = performance.now();
  const nchw = preprocessDino(bitmap);
  const tensor = new ort.Tensor('float32', nchw, [1, 3, INPUT_SIZE, INPUT_SIZE]);
  const outs = await dinoSession.run({ [dinoInput]: tensor });
  const outTensor = outs[dinoSession.outputNames[0] || 'output'];
  const raw = outTensor.data as Float32Array;
  let norm = 0;
  for (let i = 0; i < raw.length; i++) norm += raw[i] * raw[i];
  norm = Math.sqrt(norm) || 1;
  const feat = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) feat[i] = raw[i] / norm;
  return { feat, ms: performance.now() - t0 };
}

function bitmapToCanvas(bitmap: ImageBitmap, w: number, h: number): OffscreenCanvas {
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('无法创建 OCR 画布上下文');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'low';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** 单张裁剪块 -> 518×518 NCHW（与后端 preprocess 一致）。 */
function cropToNchw(bitmap: ImageBitmap, box: SegmentBox): Float32Array {
  const canvas = new OffscreenCanvas(INPUT_SIZE, INPUT_SIZE);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('无法创建 2D 画布上下文');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'low';
  ctx.clearRect(0, 0, INPUT_SIZE, INPUT_SIZE);
  ctx.drawImage(bitmap, box.x, box.y, box.w, box.h, 0, 0, INPUT_SIZE, INPUT_SIZE);
  const imgData = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data;
  const px = INPUT_SIZE * INPUT_SIZE;
  const out = new Float32Array(3 * px);
  for (let p = 0; p < px; p++) {
    const s = p * 4;
    out[0 * px + p] = (imgData[s] / 255 - MEAN[0]) / STD[0];
    out[1 * px + p] = (imgData[s + 1] / 255 - MEAN[1]) / STD[1];
    out[2 * px + p] = (imgData[s + 2] / 255 - MEAN[2]) / STD[2];
  }
  return out;
}

/**
 * 整页识别：切图（1:1 复刻后端 segment_icons）-> 分块跑 518 特征 -> 逐块 L2 归一化。
 * 切不出 2 块以上时按「整图单图」处理，与桌面版 /predict 行为一致。
 */
async function recognizeBitmap(
    bitmap: ImageBitmap,
    totalCount: number,
    nameItems: NameAnchorItem[],
    onProgress: (done: number, total: number) => void
): Promise<{ feats: Float32Array; boxes: SegmentBox[]; mode: 'single' | 'batch'; ms: number }> {
  if (!dinoSession) throw new Error('识别模型尚未初始化完成');
  const t0 = performance.now();
  const w = bitmap.width;
  const h = bitmap.height;

  const full = bitmapToCanvas(bitmap, w, h);
  const fullCtx = full.getContext('2d', { willReadFrequently: true })!;
  const rgba = fullCtx.getImageData(0, 0, w, h).data;
  let boxes = segmentIcons(rgba, w, h, { totalCount });
  let mode: 'single' | 'batch' = 'batch';

  // 连通域失败时的兜底：名字锚定几何切割（复刻 core/api/predict.py 的三道校验）
  // 典型场景：test4 那种彩色场景截图 —— 背景与头像连成一块，连通域只剩 1 个 1209×234 扁条。
  const anchors = (nameItems || []).filter((it) => hasCjk(it.text));
  if (boxes.length < 2 && anchors.length >= 1 && anchors.length <= 3) {
    const badReason = segmentLooksBad(boxes, anchors.length);
    if (badReason) {
      const anchored = segmentIconsByNameAnchors(w, h, anchors);
      const square = anchored.every((b) => Math.min(b.w, b.h) > 0 && Math.max(b.w, b.h) / Math.min(b.w, b.h) <= 1.5);
      // 只增不减 + 数量对齐名字 + 每块近正方：任一不满足就保留原连通域结果
      if (anchored.length === anchors.length && anchored.length >= boxes.length && square) {
        boxes = anchored;
        mode = 'batch';
        console.info(`[recognition.worker] 连通域分割失败（${badReason}），`
            + `名字锚定兜底切成 ${anchored.length} 块`);
      } else {
        console.debug(`[recognition.worker] 名字锚定未通过校验（锚定 ${anchored.length} / 名字 ${anchors.length} / 原 ${boxes.length}），保留原分割`);
      }
    }
  }

  if (boxes.length < 2) {
    boxes = [{ x: 0, y: 0, w, h, area: w * h }];
    mode = 'single';
  }

  const dim = 384;
  const out = new Float32Array(boxes.length * dim);
  const inputName = dinoSession.inputNames[0] || dinoInput;
  for (let start = 0; start < boxes.length; start += FEATURE_CHUNK) {
    const chunk = boxes.slice(start, start + FEATURE_CHUNK);
    const data = new Float32Array(chunk.length * 3 * INPUT_SIZE * INPUT_SIZE);
    for (let i = 0; i < chunk.length; i++) {
      data.set(cropToNchw(bitmap, chunk[i]), i * 3 * INPUT_SIZE * INPUT_SIZE);
    }
    const tensor = new ort.Tensor('float32', data, [chunk.length, 3, INPUT_SIZE, INPUT_SIZE]);
    const outs = await dinoSession.run({ [inputName]: tensor });
    const outTensor = outs[dinoSession.outputNames[0] || 'output'];
    const raw = outTensor.data as Float32Array;
    for (let i = 0; i < chunk.length; i++) {
      const base = i * dim;
      let norm = 0;
      for (let d = 0; d < dim; d++) norm += raw[base + d] * raw[base + d];
      norm = Math.sqrt(norm) || 1;
      for (let d = 0; d < dim; d++) out[(start + i) * dim + d] = raw[base + d] / norm;
    }
    onProgress(Math.min(boxes.length, start + chunk.length), boxes.length);
  }
  return { feats: out, boxes, mode, ms: performance.now() - t0 };
}

/** 完整 OCR：返回底部名字行文本/逐条名字 + 所有文本块（原图坐标）。 */
async function runOcr(bitmap: ImageBitmap): Promise<{
  text: string;
  blocks: OcrBlock[];
  items: { text: string; cx: number; cy: number; nw: number; nh: number }[];
  ms: number;
}> {
  if (!detSession || !recSession) throw new Error('OCR 模型尚未初始化完成');
  const t0 = performance.now();
  const imgW = bitmap.width;
  const imgH = bitmap.height;

  // 1) det 前向
  const { rw, rh, ratio } = detResizeSize(imgW, imgH);
  const detCanvas = bitmapToCanvas(bitmap, rw, rh);
  const detCtx = detCanvas.getContext('2d', { willReadFrequently: true })!;
  const detRgba = detCtx.getImageData(0, 0, rw, rh).data;
  const detTensor = new ort.Tensor('float32', detPreprocess(detRgba, rw, rh), [1, 3, rh, rw]);
  const detOut = await detSession.run({ [detSession.inputNames[0] || 'x']: detTensor });
  const probTensor = detOut[detSession.outputNames[0]];
  const probDims = probTensor.dims as number[];
  const ph = probDims[probDims.length - 2];
  const pw = probDims[probDims.length - 1];
  const prob = probTensor.data as Float32Array;
  const boxes = dbPostprocess(prob, pw, ph, ratio, DET_CONFIG);

  // 2) 逐框 rec
  const blocks: OcrBlock[] = [];
  const srcCanvas = bitmapToCanvas(bitmap, imgW, imgH);
  const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true })!;
  const sorted = boxes.slice().sort((a, b) => (b.box[2] - b.box[0]) * (b.box[3] - b.box[1]) - (a.box[2] - a.box[0]) * (a.box[3] - a.box[1]));
  for (const { box, score } of sorted.slice(0, MAX_OCR_BOXES)) {
    const x0 = Math.max(0, Math.floor(box[0]));
    const y0 = Math.max(0, Math.floor(box[1]));
    const x1 = Math.min(imgW, Math.ceil(box[2]));
    const y1 = Math.min(imgH, Math.ceil(box[3]));
    const cw = x1 - x0;
    const chh = y1 - y0;
    if (cw < 2 || chh < 2) continue;
    const crop = srcCtx.getImageData(x0, y0, cw, chh).data;
    const { data, width } = recPreprocess(crop, cw, chh);
    const recTensor = new ort.Tensor('float32', data, [1, 3, 48, width]);
    const recOut = await recSession.run({ [recSession.inputNames[0] || 'x']: recTensor });
    const recTensorOut = recOut[recSession.outputNames[0]];
    const dims = recTensorOut.dims as number[];
    const steps = dims[dims.length - 2];
    const classes = dims[dims.length - 1];
    const { text, conf } = ctcDecode(recTensorOut.data as Float32Array, steps, classes, ocrChars);
    if (text) {
      blocks.push({ text, conf: Math.min(conf, score + 0.5), x0, y0, x1, y1 });
    }
  }

  const text = pickBottomText(blocks, imgW);
  const items = pickBottomItems(blocks).map((it) => ({
    text: it.text,
    cx: it.x,
    cy: it.y,
    nw: it.x1 - it.x0,
    nh: it.y1 - it.y0,
  }));
  return { text, blocks, items, ms: performance.now() - t0 };
}

workerScope.onmessage = async (e: MessageEvent<InMsg>) => {
  const msg = e.data;
  try {
    if (msg.kind === 'init') {
      wasmPathsGlobal = msg.wasmPaths;
      await createDinoSession(msg.modelBuffer, msg.threads || 1);
      workerScope.postMessage({ kind: 'ready', backend, threads: ort.env.wasm.numThreads, inputName: dinoInput });
      return;
    }
    if (msg.kind === 'ocr-init') {
      ocrChars = msg.chars || [];
      detSession = await createOrtSession(msg.detBuffer, 'ocr-det');
      recSession = await createOrtSession(msg.recBuffer, 'ocr-rec');
      workerScope.postMessage({
        kind: 'ocr-ready',
        detInput: detSession.inputNames[0],
        recInput: recSession.inputNames[0],
        classes: ocrChars.length,
      });
      return;
    }
    if (msg.kind === 'extract') {
      const { feat, ms } = await extractFeature(msg.bitmap);
      workerScope.postMessage({ kind: 'feature', reqId: msg.reqId, backend, ms, data: feat }, [feat.buffer]);
      return;
    }
    if (msg.kind === 'recognize') {
      const { feats, boxes, mode, ms } = await recognizeBitmap(
          msg.bitmap,
          msg.totalCount ?? 12,
          msg.nameItems ?? [],
          (done, total) => workerScope.postMessage({ kind: 'recognize-progress', reqId: msg.reqId, done, total })
      );
      workerScope.postMessage({
        kind: 'recognize-result',
        reqId: msg.reqId,
        backend,
        ms,
        mode,
        dim: 384,
        count: boxes.length,
        boxes,
        feats,
      }, [feats.buffer]);
      return;
    }
    if (msg.kind === 'ocr') {
      const { text, blocks, items, ms } = await runOcr(msg.bitmap);
      workerScope.postMessage({ kind: 'ocr-result', reqId: msg.reqId, ms, text, blocks, items });
      return;
    }
  } catch (err) {
    const message = (err as Error)?.message || String(err);
    const reqId = (msg as { reqId?: number }).reqId;
    if (msg.kind === 'init') workerScope.postMessage({ kind: 'init-error', message });
    else if (msg.kind === 'ocr-init') workerScope.postMessage({ kind: 'ocr-init-error', message });
    else workerScope.postMessage({ kind: 'feature-error', reqId, message, source: msg.kind });
  } finally {
    const bmp = (msg as { bitmap?: ImageBitmap }).bitmap;
    bmp?.close?.();
  }
};
