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


/**
 * 空槽 / 空白裁剪判定（纯前端兜底）。
 *
 * 背景：游戏里「空槽」是一个几乎单色的浅绿色圆角方块（有时带个很淡的「?」），
 * 而所有精灵参考立绘也都垫在同一种浅绿色圆角方块上。对一块纯色空槽提 DINO 特征时，
 * 特征几乎全是「绿色底块」，会和大量立绘高相似，从而把空槽误判成 90%+ 的精灵。
 *
 * 判定（真实游戏截图标定，见 preview-seg）：
 *   - 真精灵：灰度标准差 std ≥ 55、主色占比 dominant ≤ 0.44；
 *   - 纯色空槽/空白：std ≈ 22、主色占比 ≈ 0.80；
 *   - 纯白：std ≈ 0、白像素占比 ≈ 1。
 * 在两组之间取保守分隔线，宁可放过也不误杀真精灵。
 */
export interface BlankCropStats {
  std: number;
  dominant: number;
  whiteFrac: number;
  meanSat: number;
  grayFrac: number;
  blank: boolean;
}

/** 统计一个裁剪框的平坦度指标（灰度 std / 主色占比 / 近白占比）。 */
export function cropBlankStats(
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
    box: SegmentBox
): BlankCropStats {
  const x0 = Math.max(0, box.x);
  const y0 = Math.max(0, box.y);
  const x1 = Math.min(width, box.x + box.w);
  const y1 = Math.min(height, box.y + box.h);
  const bw = x1 - x0;
  const bh = y1 - y0;
  const n = Math.max(1, bw * bh);
  let sum = 0;
  let sum2 = 0;
  let white = 0;
  // 饱和度/灰度统计（用于识别重复的灰色「?」未遇见布袋）
  let chromaSum = 0;
  let chromaGray = 0;
  let nonWhite = 0;
  // 每个通道 4 级量化（>>6），共 64 桶，纯色抗锯齿也会集中在同一桶附近。
  const buckets = new Uint32Array(64);
  let dominant = 0;
  for (let y = y0; y < y1; y++) {
    const rowBase = y * width;
    for (let x = x0; x < x1; x++) {
      const p = (rowBase + x) * 4;
      const r = rgba[p];
      const g = rgba[p + 1];
      const b = rgba[p + 2];
      // 与 toGray 一致的定点灰度
      const gr = (4899 * r + 9617 * g + 1868 * b + (1 << 13)) >> 14;
      sum += gr;
      sum2 += gr * gr;
      if (gr > 235) white++;
      const cmax = Math.max(r, g, b);
      const cmin = Math.min(r, g, b);
      const chroma = cmax - cmin;
      if (cmin < 240) {
        nonWhite++;
        chromaSum += cmax > 0 ? chroma / cmax : 0;
        if (chroma < 18) chromaGray++;
      }
      const key = ((r >> 6) << 4) | ((g >> 6) << 2) | (b >> 6);
      const v = buckets[key] + 1;
      buckets[key] = v;
      if (v > dominant) dominant = v;
    }
  }
  const mean = sum / n;
  const std = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
  const dominantFrac = dominant / n;
  const whiteFrac = white / n;
  const meanSat = nonWhite > 0 ? chromaSum / nonWhite : 0;
  const grayFrac = nonWhite > 0 ? chromaGray / nonWhite : 1;
  // 保守分隔线：std 低于 34 且主色占比高于 0.72（平坦单色），或近白占比极高（>96.5%）。
  const blank = (std < 34 && dominantFrac > 0.72) || whiteFrac > 0.965;
  return { std, dominant: dominantFrac, whiteFrac, meanSat, grayFrac, blank };
}

/** 裁剪框的灰度指纹（缩放到 S×S 后零均值单位向量），用于“重复占位符”比对。 */
function boxFingerprint(
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
    box: SegmentBox,
    S = 48
): Float32Array {
  const x0 = Math.max(0, box.x);
  const y0 = Math.max(0, box.y);
  const x1 = Math.min(width, box.x + box.w);
  const y1 = Math.min(height, box.y + box.h);
  const bw = Math.max(1, x1 - x0);
  const bh = Math.max(1, y1 - y0);
  const v = new Float32Array(S * S);
  let sum = 0;
  for (let oy = 0; oy < S; oy++) {
    const sy = y0 + Math.min(bh - 1, (oy * bh) / S | 0);
    const rowBase = sy * width;
    for (let ox = 0; ox < S; ox++) {
      const sx = x0 + Math.min(bw - 1, (ox * bw) / S | 0);
      const p = (rowBase + sx) * 4;
      const gr = (4899 * rgba[p] + 9617 * rgba[p + 1] + 1868 * rgba[p + 2] + (1 << 13)) >> 14;
      v[oy * S + ox] = gr;
      sum += gr;
    }
  }
  const mean = sum / (S * S);
  let norm = 0;
  for (let i = 0; i < v.length; i++) {
    v[i] -= mean;
    norm += v[i] * v[i];
  }
  norm = Math.sqrt(norm);
  if (norm > 1e-6) for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}

/** 批量：按框统计并返回每个框是否为空槽/空白（与 boxes 等长，1 = 空槽）。 */
export function detectBlankBoxes(
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
    boxes: SegmentBox[]
): { flags: Uint8Array; stats: BlankCropStats[] } {
  const flags = new Uint8Array(boxes.length);
  const stats: BlankCropStats[] = new Array(boxes.length);
  for (let i = 0; i < boxes.length; i++) {
    const st = cropBlankStats(rgba, width, height, boxes[i]);
    stats[i] = st;
    flags[i] = st.blank ? 1 : 0;
  }
  // 重复占位符（同排灰色「?」布袋）：同一占位符缩略图几乎完全一致（实测≈0.99），
  // 不同精灵两两不同（实测≤0.77）；再叠加“低信息量（去饱和/高灰度）”门槛。
  const n = boxes.length;
  if (n >= 2) {
    const fps: Float32Array[] = [];
    for (let i = 0; i < n; i++) fps.push(boxFingerprint(rgba, width, height, boxes[i]));
    for (let i = 0; i < n; i++) {
      if (flags[i]) continue;
      const st = stats[i];
      const lowInfo = st.meanSat < 0.18 || st.grayFrac > 0.42;
      if (!lowInfo) continue;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        let dot = 0;
        for (let k = 0; k < fps[i].length; k++) dot += fps[i][k] * fps[j][k];
        if (dot >= 0.9) {
          flags[i] = 1;
          break;
        }
      }
    }
  }
  return { flags, stats };
}
