/**
 * 浏览器内 OCR（M3）—— 对齐后端 core/vision/ocr.py（RapidOCR + PP-OCRv4 det/rec）。
 *
 * 与后端一致的部分：
 *  - det：min 边缩放到 736、32 对齐、mean/std=0.5、(x/255-0.5)/0.5、NCHW
 *  - det 后处理：二值化 thresh=0.3 -> 连通域求框 -> 框均值 < box_thresh(0.5) 丢弃 ->
 *    按 unclip_ratio=1.6 外扩（面积/周长公式，与 PaddleOCR unclip 同式）
 *  - rec：高 48、宽等比、宽上限 320、(x/255-0.5)/0.5、NCHW；CTC greedy（去重 + 去 blank）
 *  - 名字行提取：复刻 OCREngine.recognize_single_bottom_text（黑名单 / 中心距择优 / y 容差 30）
 *  - 纠错表：datasets/ocr_corrections.json 的整词 + 单字替换
 *
 * 与后端的已知差异（都做了显式上限，避免浏览器端卡死）：
 *  1) 连通域 + 轴对齐外接框替代 contours + minAreaRect：精灵名是水平文字条，
 *     轴对齐框足够；斜排文字（本项目不存在）会略有偏差。
 *  2) det 放大倍数上限 maxUpscale=3（后端 limit_type=min 会无限放大到 736），
 *     避免一张小图被拉到几千像素宽后卡住主线程。
 *  3) cls 方向分类模型暂不迁移（名字条方向固定向上）。
 */

export interface OcrBlock {
  text: string;
  conf: number;
  /** 原图像素坐标（左上/右下）。 */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface DetConfig {
  limitSideLen: number;
  maxUpscale: number;
  maxSideLen: number;
  thresh: number;
  boxThresh: number;
  unclipRatio: number;
  minArea: number;
}

export const DET_CONFIG: DetConfig = {
  limitSideLen: 736,
  maxUpscale: 3,
  maxSideLen: 1600,
  thresh: 0.3,
  boxThresh: 0.5,
  unclipRatio: 1.6,
  minArea: 9,
};

export const REC_HEIGHT = 48;
export const REC_MAX_WIDTH = 320;

const BLACKLIST = ['额外', '掉落', '获取', '碎片'];

/** det 输入尺寸：min 边不小于 limitSideLen（含放大上限），并 32 对齐。 */
export function detResizeSize(w: number, h: number, cfg: DetConfig = DET_CONFIG): { rw: number; rh: number; ratio: number } {
  const minSide = Math.min(w, h);
  const maxSide = Math.max(w, h);
  let ratio = 1;
  if (minSide < cfg.limitSideLen) ratio = cfg.limitSideLen / minSide;
  if (ratio > cfg.maxUpscale) ratio = cfg.maxUpscale;
  if (maxSide * ratio > cfg.maxSideLen) ratio = cfg.maxSideLen / maxSide;
  const rw = Math.max(32, Math.round((w * ratio) / 32) * 32);
  const rh = Math.max(32, Math.round((h * ratio) / 32) * 32);
  return { rw, rh, ratio };
}

/** RGBA -> det 输入张量（NCHW，mean/std=0.5）。 */
export function detPreprocess(rgba: Uint8ClampedArray, rw: number, rh: number): Float32Array {
  const px = rw * rh;
  const out = new Float32Array(3 * px);
  for (let p = 0; p < px; p++) {
    const s = p * 4;
    out[0 * px + p] = (rgba[s] / 255 - 0.5) / 0.5;
    out[1 * px + p] = (rgba[s + 1] / 255 - 0.5) / 0.5;
    out[2 * px + p] = (rgba[s + 2] / 255 - 0.5) / 0.5;
  }
  return out;
}

/** det 概率图 -> 原图坐标系下的文本框（连通域 + 外扩）。 */
export function dbPostprocess(
    prob: Float32Array,
    w: number,
    h: number,
    ratio: number,
    cfg: DetConfig = DET_CONFIG
): { box: [number, number, number, number]; score: number }[] {
  const visited = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const out: { box: [number, number, number, number]; score: number }[] = [];

  for (let start = 0; start < w * h; start++) {
    if (visited[start] || prob[start] <= cfg.thresh) continue;
    let sp = 0;
    stack[sp++] = start;
    visited[start] = 1;
    let minX = w;
    let maxX = -1;
    let minY = h;
    let maxY = -1;
    let count = 0;
    let sum = 0;
    while (sp > 0) {
      const idx = stack[--sp];
      const y = (idx / w) | 0;
      const x = idx - y * w;
      count++;
      sum += prob[idx];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      // 4 邻域
      if (x > 0 && !visited[idx - 1] && prob[idx - 1] > cfg.thresh) {
        visited[idx - 1] = 1;
        stack[sp++] = idx - 1;
      }
      if (x + 1 < w && !visited[idx + 1] && prob[idx + 1] > cfg.thresh) {
        visited[idx + 1] = 1;
        stack[sp++] = idx + 1;
      }
      if (y > 0 && !visited[idx - w] && prob[idx - w] > cfg.thresh) {
        visited[idx - w] = 1;
        stack[sp++] = idx - w;
      }
      if (y + 1 < h && !visited[idx + w] && prob[idx + w] > cfg.thresh) {
        visited[idx + w] = 1;
        stack[sp++] = idx + w;
      }
    }
    if (count < cfg.minArea) continue;
    const score = sum / count;
    if (score < cfg.boxThresh) continue;

    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    // PaddleOCR unclip：d = area * ratio / perimeter
    const d = (bw * bh * cfg.unclipRatio) / (2 * (bw + bh));
    const x0 = Math.max(0, (minX - d) / ratio);
    const y0 = Math.max(0, (minY - d) / ratio);
    const x1 = Math.min(w / ratio, (maxX + 1 + d) / ratio);
    const y1 = Math.min(h / ratio, (maxY + 1 + d) / ratio);
    if (x1 - x0 < 2 || y1 - y0 < 2) continue;
    out.push({ box: [x0, y0, x1, y1], score });
  }
  return out;
}

/** rec 输入：高 48、宽等比（上限 320），mean/std=0.5，输出 NCHW + 实际宽度。 */
export function recPreprocess(
    rgba: Uint8ClampedArray,
    w: number,
    h: number
): { data: Float32Array; width: number } {
  const t = Math.max(1, h);
  const targetW = Math.max(4, Math.min(REC_MAX_WIDTH, Math.ceil((REC_HEIGHT * w) / t)));
  const px = REC_HEIGHT * targetW;
  const out = new Float32Array(3 * px);
  // 逐像素按比例回采样（与 cv2.resize INTER_LINEAR 的差别只在边界像素）
  for (let y = 0; y < REC_HEIGHT; y++) {
    const sy = Math.min(h - 1, Math.floor((y * h) / REC_HEIGHT));
    for (let x = 0; x < targetW; x++) {
      const sx = Math.min(w - 1, Math.floor((x * w) / targetW));
      const s = (sy * w + sx) * 4;
      const p = y * targetW + x;
      out[0 * px + p] = (rgba[s] / 255 - 0.5) / 0.5;
      out[1 * px + p] = (rgba[s + 1] / 255 - 0.5) / 0.5;
      out[2 * px + p] = (rgba[s + 2] / 255 - 0.5) / 0.5;
    }
  }
  return { data: out, width: targetW };
}

/** CTC greedy 解码：argmax -> 去连续重复 -> 去 blank(0) -> 查表；conf 取保留位置的概率均值。 */
export function ctcDecode(
    probs: Float32Array,
    timeSteps: number,
    classes: number,
    chars: string[]
): { text: string; conf: number } {
  let prev = -1;
  let text = '';
  let confSum = 0;
  let confN = 0;
  for (let t = 0; t < timeSteps; t++) {
    const base = t * classes;
    let bestIdx = 0;
    let bestVal = -Infinity;
    for (let c = 0; c < classes; c++) {
      const v = probs[base + c];
      if (v > bestVal) {
        bestVal = v;
        bestIdx = c;
      }
    }
    if (bestIdx !== prev && bestIdx > 0) {
      text += chars[bestIdx] ?? '';
      confSum += bestVal;
      confN++;
    }
    prev = bestIdx;
  }
  return { text, conf: confN ? confSum / confN : 0 };
}

/** 只保留中文/英文/数字（复刻 ocr.py 的 re.sub）。 */
export function cleanOcrText(text: string): string {
  return (text || '').replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');
}

/** 过滤低置信 + 黑名单噪声（额外/掉落/获取/碎片），只保留中文/英文/数字文本。 */
function usableItems(blocks: OcrBlock[], minConfidence: number) {
  const items: { text: string; x: number; y: number; x0: number; y0: number; x1: number; y1: number }[] = [];
  for (const b of blocks) {
    if (b.conf < minConfidence) continue;
    const raw = (b.text || '').replace(/\s+/g, '');
    if (BLACKLIST.some((n) => raw.includes(n))) continue;
    const cleaned = cleanOcrText(raw);
    if (!cleaned) continue;
    items.push({
      text: cleaned,
      x: (b.x0 + b.x1) / 2,
      y: (b.y0 + b.y1) / 2,
      x0: b.x0,
      y0: b.y0,
      x1: b.x1,
      y1: b.y1,
    });
  }
  return items;
}

/**
 * 复刻 OCREngine.recognize_single_bottom_text：
 * 先取最底部块，再在 50px 内挑更靠图片中心线的块，取该块 y±30 的同行块按 x 升序拼接。
 */
export function pickBottomText(
    blocks: OcrBlock[],
    imageWidth: number,
    minConfidence = 0.3,
    yTolerance = 30
): string {
  const centerX = imageWidth / 2;
  const base = usableItems(blocks, minConfidence);
  const items = base.map((b) => ({ ...b, dist: Math.abs(b.x - centerX) }));
  if (!items.length) return '';

  items.sort((a, b) => b.y - a.y);
  let best = items[0];
  for (let i = 1; i < items.length; i++) {
    if (Math.abs(items[i].y - best.y) < 50 && items[i].dist < best.dist * 0.5) best = items[i];
  }
  const line = [best, ...items.filter((b) => b !== best && Math.abs(b.y - best.y) < yTolerance)];
  line.sort((a, b) => a.x - b.x);
  return line.map((b) => b.text).join('');
}

/**
 * 复刻 OCREngine.recognize_bottom_items：按 y 从下往上聚类成行，取【最底部一行】，
 * 行内按 x 升序返回逐条名字 —— 批量识别时用它给每个图位配名字（与后端 init_batch 一致）。
 */
export function pickBottomItems(
    blocks: OcrBlock[],
    minConfidence = 0.3,
    yTolerance = 30
): { text: string; x: number; y: number; x0: number; y0: number; x1: number; y1: number }[] {
  const items = usableItems(blocks, minConfidence);
  if (!items.length) return [];
  const sorted = items.slice().sort((a, b) => b.y - a.y);
  const lines: (typeof sorted)[] = [];
  for (const b of sorted) {
    let placed = false;
    for (const line of lines) {
      const avgY = line.reduce((s, it) => s + it.y, 0) / line.length;
      if (Math.abs(b.y - avgY) < yTolerance) {
        line.push(b);
        placed = true;
        break;
      }
    }
    if (!placed) lines.push([b]);
  }
  const bottom = lines[0];
  bottom.sort((a, b) => a.x - b.x);
  return bottom;
}

export interface Corrections {
  word: Record<string, string>;
  char: Record<string, string>;
}

/** 复刻 core/vision/ocr_corrections.py：先整词替换，再逐字替换。 */
export function correctOcrText(text: string, corrections: Corrections | null): string {
  if (!text || !corrections) return text;
  const whole = corrections.word?.[text];
  let out = whole ?? text;
  if (corrections.char && Object.keys(corrections.char).length) {
    out = out
        .split('')
        .map((ch) => corrections.char[ch] ?? ch)
        .join('');
  }
  return out;
}

export function parseCorrections(raw: unknown): Corrections | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as { word_corrections?: Record<string, string>; char_corrections?: Record<string, string> };
  return { word: obj.word_corrections || {}, char: obj.char_corrections || {} };
}
