/**
 * 整页截图切图（纯前端）—— 1:1 复刻后端 core/vision/processor.py::segment_icons。
 *
 * 链路：灰度 -> 二值化(>200 视为背景) -> 椭圆核轻度膨胀(环形+精灵连成一块)
 *      -> 8 邻域连通域 -> 面积/尺寸双阈值过滤 -> 按行聚类行内按 x 排序 -> pad=5 裁剪。
 *
 * 与后端的差异：连通域统计与排序都在 JS 里手写（这里用迭代式 flood fill + 逐像素椭圆核），
 * 参数与判定顺序完全照抄；结果用 tools/verify_segments.mjs 与 cv2 逐框对照。
 */

export interface SegmentBox {
  x: number;
  y: number;
  w: number;
  h: number;
  area: number;
}

/**
 * OpenCV cvtColor(BGR2GRAY) 的定点实现：
 *   gray = (4899*R + 9617*G + 1868*B + (1<<13)) >> 14
 * 用浮点 0.299/0.587/0.114 + 截断会和 cv2 差 1 个灰度值，
 * 在阈值 200 附近的像素就会翻转，导致切图框面积（甚至框本身）对不上。
 */
export function toGray(rgba: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const gray = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = (4899 * rgba[p] + 9617 * rgba[p + 1] + 1868 * rgba[p + 2] + (1 << 13)) >> 14;
  }
  return gray;
}

/** THRESH_BINARY_INV, thresh=200：灰度 > 200 记背景(0)，否则前景(1)。 */
export function binarize(gray: Uint8Array, thresh = 200): Uint8Array {
  const out = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) out[i] = gray[i] > thresh ? 0 : 1;
  return out;
}

/**
 * OpenCV getStructuringElement(MORPH_ELLIPSE, (k,k)) 的真实形状（k=2..12，1=命中）。
 * 注意 OpenCV 的偶数核并不中心对称（k=6 的第 2 行是全 1、第 5 行却不是），
 * 所以这里直接固化 cv2 生成的位图，而不是用圆方程近似——差 1 像素就会让切图框错位。
 */
const CV_ELLIPSE_KERNELS: Record<number, string[]> = {
  2: ['01', '11'],
  3: ['010', '111', '010'],
  4: ['0010', '1111', '1111', '1111'],
  5: ['00100', '11111', '11111', '11111', '00100'],
  6: ['000100', '011111', '111111', '111111', '111111', '011111'],
  7: ['0001000', '0111110', '1111111', '1111111', '1111111', '0111110', '0001000'],
  8: ['00001000', '01111111', '01111111', '11111111', '11111111', '11111111', '01111111', '01111111'],
  9: ['000010000', '011111110', '011111110', '111111111', '111111111', '111111111', '011111110', '011111110', '000010000'],
  10: ['0000010000', '0011111110', '0111111111', '1111111111', '1111111111', '1111111111', '1111111111', '1111111111', '0111111111', '0011111110'],
  11: ['00000100000', '00111111100', '01111111110', '11111111111', '11111111111', '11111111111', '11111111111', '11111111111', '01111111110', '00111111100', '00000100000'],
  12: ['000000100000', '000111111100', '001111111110', '011111111111', '111111111111', '111111111111', '111111111111', '111111111111', '111111111111', '011111111111', '001111111110', '000111111100'],
};

/** 取 OpenCV 椭圆核；超过表范围用矩形核兜底（实际 kernel_size 由短边/240 决定，不会那么大）。 */
export function ellipseKernel(k: number): { size: number; mask: Uint8Array } {
  const size = Math.max(1, k | 0);
  const mask = new Uint8Array(size * size);
  const rows = CV_ELLIPSE_KERNELS[size];
  if (!rows) {
    mask.fill(1);
    return { size, mask };
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) mask[y * size + x] = rows[y][x] === '1' ? 1 : 0;
  }
  return { size, mask };
}

/** 形态学膨胀（二值，前景=1）。 */
export function dilate(src: Uint8Array, width: number, height: number, kernelSize: number): Uint8Array {
  const { size, mask } = ellipseKernel(kernelSize);
  // OpenCV 默认锚点 = (ksize/2, ksize/2)（整数除法），偶数核会略微偏右下，必须照抄
  const anchor = size >> 1;
  const out = new Uint8Array(src.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let hit = 0;
      for (let ky = 0; ky < size && !hit; ky++) {
        const sy = y + ky - anchor;
        if (sy < 0 || sy >= height) continue;
        for (let kx = 0; kx < size; kx++) {
          if (!mask[ky * size + kx]) continue;
          const sx = x + kx - anchor;
          if (sx < 0 || sx >= width) continue;
          if (src[sy * width + sx]) {
            hit = 1;
            break;
          }
        }
      }
      out[y * width + x] = hit;
    }
  }
  return out;
}

/** 8 邻域连通域统计（x,y,w,h,area），等价 connectedComponentsWithStats(connectivity=8)。 */
export function connectedComponents(mask: Uint8Array, width: number, height: number): SegmentBox[] {
  const visited = new Uint8Array(mask.length);
  const stack = new Int32Array(mask.length);
  const out: SegmentBox[] = [];
  const neighbors = [-width - 1, -width, -width + 1, -1, 1, width - 1, width, width + 1];

  for (let start = 0; start < mask.length; start++) {
    if (visited[start] || !mask[start]) continue;
    let sp = 0;
    stack[sp++] = start;
    visited[start] = 1;
    let minX = width;
    let maxX = -1;
    let minY = height;
    let maxY = -1;
    let area = 0;
    while (sp > 0) {
      const idx = stack[--sp];
      const y = (idx / width) | 0;
      const x = idx - y * width;
      area++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (let n = 0; n < 8; n++) {
        const nb = idx + neighbors[n];
        if (nb < 0 || nb >= mask.length) continue;
        // 防止 8 邻域跨行绕回
        const nby = (nb / width) | 0;
        if (nby !== y && Math.abs(nby - y) !== 1) continue;
        if (visited[nb] || !mask[nb]) continue;
        visited[nb] = 1;
        stack[sp++] = nb;
      }
    }
    out.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, area });
  }
  return out;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** 复刻 _sort_components_row_major：先按中心 y 聚行，行内按中心 x 升序。 */
export function sortComponentsRowMajor(comps: SegmentBox[]): SegmentBox[] {
  if (comps.length <= 1) return comps.slice();
  const items = comps
      .map((c) => ({ cy: c.y + c.h / 2, cx: c.x + c.w / 2, comp: c }))
      .sort((a, b) => (a.cy - b.cy) || (a.cx - b.cx));

  const medianH = median(comps.map((c) => c.h));
  const gaps: number[] = [];
  for (let i = 0; i + 1 < items.length; i++) {
    if (items[i + 1].cy > items[i].cy) gaps.push(items[i + 1].cy - items[i].cy);
  }
  const medianGap = gaps.length ? median(gaps) : 0;
  const tolerance = Math.max(medianH * 0.6, medianGap * 0.45);

  const rows: { meanY: number; items: typeof items }[] = [];
  for (const item of items) {
    let placed = false;
    for (const row of rows) {
      if (Math.abs(item.cy - row.meanY) <= tolerance) {
        row.items.push(item);
        row.meanY = row.items.reduce((s, it) => s + it.cy, 0) / row.items.length;
        placed = true;
        break;
      }
    }
    if (!placed) rows.push({ meanY: item.cy, items: [item] });
  }
  rows.sort((a, b) => a.meanY - b.meanY);
  const ordered: SegmentBox[] = [];
  for (const row of rows) {
    row.items.sort((a, b) => a.cx - b.cx);
    for (const it of row.items) ordered.push(it.comp);
  }
  return ordered;
}

export interface SegmentOptions {
  totalCount?: number;
  pad?: number;
  /** 复刻 kernel_size = max(2, int(short_side / 240))。 */
  kernelSize?: number;
}

/** OCR 名字项（原图像素坐标），用于「名字锚定几何切割」。 */
export interface NameAnchorItem {
  text: string;
  /** 名字框中心。 */
  cx: number;
  cy: number;
  /** 名字框宽/高。 */
  nw: number;
  nh: number;
}

/** 只保留含中文的文本块（剔除 OCR 在纯头像图上把图案认成 'O'/'Ua' 的假名字）。 */
export function hasCjk(text: string): boolean {
  return /[\u4e00-\u9fa5]/.test(text || '');
}

export type SegmentBadReason = 'empty' | 'merged_flat' | null;

/**
 * 复刻 core/api/predict.py::_segment_looks_bad —— 只识别「原连通域分割明确失败」的强信号：
 *  - 一块都没切出（且确实有名字）-> empty；
 *  - 切出块数已 >= 名字数：视为分割充分，绝不兜底覆盖；
 *  - 块数 < 名字数 且存在宽高比 >= flat_aspect 的严重扁条（多只被粘连成一条）-> merged_flat。
 */
export function segmentLooksBad(
    boxes: SegmentBox[],
    expectN: number,
    flatAspect = 2.5
): SegmentBadReason {
  if (!boxes.length) return expectN > 0 ? 'empty' : null;
  if (boxes.length >= expectN) return null;
  for (const b of boxes) {
    const minSide = Math.min(b.w, b.h);
    if (minSide > 0 && Math.max(b.w, b.h) / minSide >= flatAspect) return 'merged_flat';
  }
  return null;
}

export interface AnchorOptions {
  /** 头像直径 ≈ kDiam * 名字字高。 */
  kDiam?: number;
  /** 头像与名字之间的相对间隙。 */
  kGap?: number;
  pad?: number;
  /** 字高离群容差（相对中位字高）。 */
  nhTol?: number;
}

/**
 * 复刻 core/vision/processor.py::segment_icons_by_name_anchors —— 名字锚定几何切割。
 *
 * 不做前景分割、不依赖检测模型，只用这类 UI 的硬几何约束由名字框反推头像：
 *   - 头像中心 x = 名字框中心 x（名字水平居中于头像）；
 *   - 尺度取「同行名字字高」中位数：头像直径 D ≈ kDiam × 字高；
 *   - 头像中心 y = 名字中心 y 上移 (D/2 + kGap*D + 字高/2)。
 * 返回顺序与传入的名字项完全一致（即与 OCR 名字一一对齐）。
 */
export function segmentIconsByNameAnchors(
    width: number,
    height: number,
    nameItems: NameAnchorItem[],
    options: AnchorOptions = {}
): SegmentBox[] {
  const kDiam = options.kDiam ?? 4.2;
  const kGap = options.kGap ?? 0.13;
  const pad = options.pad ?? 5;
  const nhTol = options.nhTol ?? 0.35;
  if (!nameItems || !nameItems.length) return [];

  const heights = nameItems.map((it) => Number(it.nh) || 0).sort((a, b) => a - b);
  const nhMed = heights.length % 2
      ? heights[(heights.length - 1) >> 1]
      : (heights[heights.length / 2 - 1] + heights[heights.length / 2]) / 2;
  if (!(nhMed > 0)) return [];

  // 丢弃字高离群的噪声文字块，保留与同行主字号一致的名字
  let items = nameItems.filter((it) => Math.abs((Number(it.nh) || 0) - nhMed) <= nhTol * nhMed);
  if (!items.length) items = nameItems.slice();

  const diam = kDiam * nhMed;
  const half = diam / 2;
  const out: SegmentBox[] = [];
  for (const it of items) {
    const cx = Number(it.cx);
    const nameCy = Number(it.cy);
    const nh = Number(it.nh) || nhMed;
    const headCy = nameCy - (half + kGap * diam + nh / 2);

    const x1 = Math.max(0, Math.round(cx - half - pad));
    const x2 = Math.min(width, Math.round(cx + half + pad));
    const y1 = Math.max(0, Math.round(headCy - half - pad));
    const y2 = Math.min(height, Math.round(headCy + half + pad));
    if (x2 <= x1 || y2 <= y1) continue;
    out.push({ x: x1, y: y1, w: x2 - x1, h: y2 - y1, area: (x2 - x1) * (y2 - y1) });
  }
  return out;
}

/**
 * 整页切图。返回按阅读顺序排列的图标框（原图坐标，已含 pad），最多 totalCount 个。
 * 与后端一致：没有有效连通域时返回 []。
 */
export function segmentIcons(
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
    options: SegmentOptions = {}
): SegmentBox[] {
  const totalCount = options.totalCount ?? 999;
  const pad = options.pad ?? 5;
  const shortSide = Math.min(width, height);
  const kernelSize = options.kernelSize ?? Math.max(2, Math.floor(shortSide / 240));

  const gray = toGray(rgba, width, height);
  const binary = binarize(gray, 200);
  const dil = dilate(binary, width, height, kernelSize);
  let comps = connectedComponents(dil, width, height);
  if (!comps.length) return [];

  const maxArea = Math.max(...comps.map((c) => c.area));
  const big = comps.filter((c) => c.area >= maxArea * 0.15);
  if (!big.length) return [];
  const refW = median(big.map((c) => c.w));
  const refH = median(big.map((c) => c.h));

  comps = comps.filter((c) => c.area >= maxArea * 0.12 && c.w >= refW * 0.45 && c.h >= refH * 0.45);
  comps = sortComponentsRowMajor(comps);

  const out: SegmentBox[] = [];
  for (const c of comps) {
    if (out.length >= totalCount) break;
    const x1 = Math.max(0, c.x - pad);
    const y1 = Math.max(0, c.y - pad);
    const x2 = Math.min(width, c.x + c.w + pad);
    const y2 = Math.min(height, c.y + c.h + pad);
    out.push({ x: x1, y: y1, w: x2 - x1, h: y2 - y1, area: c.area });
  }
  return out;
}
