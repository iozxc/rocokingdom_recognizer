// 颜色签名（TS 侧唯一实现）：必须与 core/vision/color_feature.py 完全一致
//   HSV 直方图 bins=(12,4,4)，只统计「有彩色」像素（S>60 且 V>60），和≈255
// 与 Python 的 OpenCV 语义对齐：H∈[0,179]（角度/2），S、V∈[0,255]
export const COLOR_BINS = [12, 4, 4] as const;
export const COLOR_BINS_H = 12;
export const COLOR_BINS_S = 4;
export const COLOR_BINS_V = 4;
export const COLOR_DIM = COLOR_BINS_H * COLOR_BINS_S * COLOR_BINS_V; // 192
export const COLOR_SAT_MIN = 60;
export const COLOR_VAL_MIN = 60;
/** 配色权重：匹配度 = (1-W)*DINO余弦 + W*配色相关度（凸组合，结果天然 ≤1） */
export const COLOR_FUSE_W = 0.10;

/** 从 RGBA 像素里取一个矩形区域，算 uint8 颜色签名（和≈255）。 */
export function colorSignatureFromRGBA(
    rgba: Uint8ClampedArray | Uint8Array,
    imgW: number,
    imgH: number,
    box: { x: number; y: number; w: number; h: number },
): Uint8Array {
  const hist = new Float64Array(COLOR_DIM);
  const x0 = Math.max(0, Math.floor(box.x));
  const y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(imgW, Math.ceil(box.x + box.w));
  const y1 = Math.min(imgH, Math.ceil(box.y + box.h));
  let colored = 0;
  let total = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const p = (y * imgW + x) * 4;
      const r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
      const a = rgba[p + 3];
      if (a < 32) continue;              // 透明像素不计入（与 Python 端 RGBA->RGB 后统计等价）
      total++;
      const rr = r / 255, gg = g / 255, bb = b / 255;
      const mx = Math.max(rr, gg, bb), mn = Math.min(rr, gg, bb);
      const d = mx - mn;
      const v = mx * 255;
      const s = mx > 0 ? (d / mx) * 255 : 0;
      if (s <= COLOR_SAT_MIN || v <= COLOR_VAL_MIN) continue;   // 深色圆框 / 浅色背景被排除
      let hDeg = 0;
      if (d > 1e-9) {
        if (mx === rr) hDeg = 60 * (((gg - bb) / d) % 6);
        else if (mx === gg) hDeg = 60 * (((bb - rr) / d) + 2);
        else hDeg = 60 * (((rr - gg) / d) + 4);
        if (hDeg < 0) hDeg += 360;
      }
      const hOcv = hDeg / 2;                          // OpenCV: H∈[0,179]
      const hb = Math.min(COLOR_BINS_H - 1, Math.floor(hOcv / (180 / COLOR_BINS_H)));
      const sb = Math.min(COLOR_BINS_S - 1, Math.floor(s / (256 / COLOR_BINS_S)));
      const vb = Math.min(COLOR_BINS_V - 1, Math.floor(v / (256 / COLOR_BINS_V)));
      hist[(hb * COLOR_BINS_S + sb) * COLOR_BINS_V + vb] += 1;
      colored++;
    }
  }
  const out = new Uint8Array(COLOR_DIM);
  if (colored < 20) {
    // 几乎没有彩色像素：与 Python 端一致，退回「全图」统计（这里用总量兜底）
    if (total <= 0) return out;
    out.fill(Math.round(255 / COLOR_DIM));
    return out;
  }
  let sum = 0;
  for (let i = 0; i < COLOR_DIM; i++) sum += hist[i];
  for (let i = 0; i < COLOR_DIM; i++) {
    out[i] = Math.max(0, Math.min(255, Math.round((hist[i] / sum) * 255)));
  }
  return out;
}

/** 单个签名 -> 去均值 + L2 归一化（用于算 Pearson 相关度）。 */
export function normalizeColorSignature(sig: Uint8Array): Float32Array {
  const q = new Float32Array(COLOR_DIM);
  let mean = 0;
  for (let i = 0; i < COLOR_DIM; i++) mean += sig[i];
  mean /= COLOR_DIM;
  let norm = 0;
  for (let i = 0; i < COLOR_DIM; i++) {
    const v = sig[i] - mean;
    q[i] = v;
    norm += v * v;
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < COLOR_DIM; i++) q[i] /= norm;
  return q;
}

/** 整库签名矩阵（n×COLOR_DIM，uint8）-> 每行去均值 + L2 归一化，便于批量算相关度。 */
export function normalizeColorRows(rows: Uint8Array, n: number): Float32Array {
  const out = new Float32Array(n * COLOR_DIM);
  for (let r = 0; r < n; r++) {
    const base = r * COLOR_DIM;
    let mean = 0;
    for (let d = 0; d < COLOR_DIM; d++) mean += rows[base + d];
    mean /= COLOR_DIM;
    let norm = 0;
    for (let d = 0; d < COLOR_DIM; d++) {
      const v = rows[base + d] - mean;
      out[base + d] = v;
      norm += v * v;
    }
    norm = Math.sqrt(norm) || 1;
    for (let d = 0; d < COLOR_DIM; d++) out[base + d] /= norm;
  }
  return out;
}

/** 两个签名（未经归一化）的 Pearson 相关度，供排查/日志用。 */
export function colorCorr(a: Uint8Array, b: Uint8Array): number {
  const qa = normalizeColorSignature(a);
  const qb = normalizeColorSignature(b);
  let s = 0;
  for (let i = 0; i < COLOR_DIM; i++) s += qa[i] * qb[i];
  return s;
}
