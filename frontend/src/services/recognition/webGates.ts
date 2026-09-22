/**
 * 纯前端版「自动模式」固定 ROI 像素门 —— 1:1 移植 desktop/auto_watch.py，
 * 不跑 YOLO / 推理，只在抓帧上读像素（浏览器里没有窗口句柄/PrintWindow，帧来自
 * getDisplayMedia；ROI 全部是相对全帧比例，随共享分辨率自适应缩放）。
 *
 * 四道状态门（阈值均在 train/dataset/roi 的 8 张样本上实测，两种分辨率都验证过）：
 *  - HP 绿血条：战斗时右上角敌方绿血条亮绿占比（非战斗 0.2%，战斗 18%+）
 *  - 三卡暗面板：三块黑色信息面板的暗像素占比（三卡选择界面都 ≥0.40，其它 <0.35）
 *  - 技能黄按钮：底部亮黄「选择」按钮占比（三技能卡弹窗 0.43，精灵三卡为 0），用于排除技能弹窗
 *  - Boss 白盘：同伴槽位行的灰星核+暖白环+暗轮廓 ring 检测（Boss 5 个，普通战斗 0）
 *
 * Boss 门是诊断脚本 diag_final2.py 定稿的纯 JS 版本（弃用 HoughCircles）：
 * 关键是必须保留「灰星核 cf>0.45」这条 —— 普通战斗的亮云/亮石环白可能 1.0 但灰核 ≤0.11。
 */

/** 相对全帧的 ROI 框（[x1,y1,x2,y2]，0~1）。 */
export type RelBox = [number, number, number, number];

/** 敌方绿血条。 */
export const HP_BAR: RelBox = [0.715, 0.066, 0.895, 0.104];
/** Boss 同伴槽位行（只覆盖 5 个白盘的窄带，排除左侧宠物头像/★黑标/右侧名字）。 */
export const DISC_ROW: RelBox = [0.79, 0.098, 0.866, 0.14];
/** 三张卡的黑色信息面板（含「重置奖励 / 击败后获得」）。 */
export const CARD_PANELS: RelBox[] = [
  [0.18, 0.42, 0.39, 0.6],
  [0.39, 0.42, 0.61, 0.6],
  [0.61, 0.42, 0.82, 0.6],
];
/** 技能选择弹窗底部黄色「选择」按钮。 */
export const SKILL_BTN: RelBox = [0.42, 0.9, 0.58, 0.98];
/** 选择界面 3 张卡圆形头像的中心区域（逐张卡检测玩家单独刷新）。 */
export const CARD_PORTRAITS: RelBox[] = [
  [0.295, 0.305, 0.347, 0.37],
  [0.481, 0.305, 0.533, 0.37],
  [0.669, 0.305, 0.721, 0.37],
];

/** 战斗门阈值。 */
export const GREEN_MIN = 0.05;
/** Boss 同伴槽位白盘数量阈值。 */
export const BOSS_CIRCLES_MIN = 3;
/** 单个卡面板暗像素占比阈值（实测最低 0.506，NPC/走路/战斗 <0.35）。 */
export const PANEL_DARK_MIN = 0.4;
/** 技能弹窗黄按钮占比阈值（弹窗 0.43，三卡/走路 0）。 */
export const SKILL_BTN_MIN = 0.2;
/** 头像归一化尺寸 / 高斯模糊半径。 */
export const CARD_TILE_SIZE = 32;
export const CARD_TILE_BLUR = 3;
/** 换卡差异（同卡地板 0.04、亮度±5% 0.04，实测换卡最低 0.147）。 */
export const CARD_CHANGE_MIN = 0.08;
/** 相邻帧差小于该值视为翻牌动画结束、画面稳定。 */
export const CARD_STABLE_MAX = 0.05;

/** 一张头像 tile 的 RGB / HSV 归一化特征（用于逐卡差分）。 */
export interface CardTile {
  rgb: Float32Array; // 3*N，0~1
  hsv: Float32Array; // 3*N，H 0~1（环形）、S/V 0~1
}

/** 标准 RGB(0~255) -> HSV（h: 0~360, s/v: 0~1）。 */
function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const rf = r / 255;
  const gf = g / 255;
  const bf = b / 255;
  const mx = Math.max(rf, gf, bf);
  const mn = Math.min(rf, gf, bf);
  const d = mx - mn;
  let h = 0;
  if (d !== 0) {
    if (mx === rf) h = 60 * (((gf - bf) / d) % 6);
    else if (mx === gf) h = 60 * ((bf - rf) / d + 2);
    else h = 60 * ((rf - gf) / d + 4);
    if (h < 0) h += 360;
  }
  return { h, s: mx === 0 ? 0 : d / mx, v: mx };
}

/* ---------------- 纯像素判定（输入 RGBA 数组，便于离线单测） ---------------- */

/** 绿血条亮绿占比（H80~190°、S≥110/255、V≥120/255）。 */
export function greenFractionRgba(rgba: Uint8Array | Uint8ClampedArray): number {
  const total = rgba.length / 4;
  if (total <= 0) return 0;
  let hit = 0;
  for (let i = 0; i < total; i++) {
    const { h, s, v } = rgbToHsv(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
    if (h >= 80 && h <= 190 && s >= 110 / 255 && v >= 120 / 255) hit++;
  }
  return hit / total;
}

/** 暗像素占比（灰度<80）。 */
export function darkFractionRgba(rgba: Uint8Array | Uint8ClampedArray): number {
  const total = rgba.length / 4;
  if (total <= 0) return 0;
  let dark = 0;
  for (let i = 0; i < total; i++) {
    const gray = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
    if (gray < 80) dark++;
  }
  return dark / total;
}

/** 技能黄按钮亮黄占比（H30~70°、S≥120/255、V≥150/255）。 */
export function yellowFractionRgba(rgba: Uint8Array | Uint8ClampedArray): number {
  const total = rgba.length / 4;
  if (total <= 0) return 0;
  let hit = 0;
  for (let i = 0; i < total; i++) {
    const { h, s, v } = rgbToHsv(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
    if (h >= 30 && h <= 70 && s >= 120 / 255 && v >= 150 / 255) hit++;
  }
  return hit / total;
}

/** Boss 同伴槽位白盘数量（灰星核+暖白环+暗轮廓，diag_final2.py 定稿）。 */
export function bossDiscCountFromRgba(rgba: Uint8Array | Uint8ClampedArray, w: number, h: number): number {
  const n = w * h;
  const white = new Uint8Array(n);
  const core = new Uint8Array(n);
  const dark = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    if (mx - mn < 28 && mn > 205) white[i] = 1;
    if (mx - mn < 38 && mx >= 95 && mx <= 165) core[i] = 1;
    if (mx - mn < 45 && mx < 150) dark[i] = 1;
  }
  const radius = Math.max(5, Math.round(0.062 * w));
  const ann: Array<[number, number]> = [];
  const corePts: Array<[number, number]> = [];
  const outPts: Array<[number, number]> = [];
  const rr = Math.round(radius * 1.2);
  for (let dy = -rr; dy <= rr; dy++) {
    for (let dx = -rr; dx <= rr; dx++) {
      const d = Math.sqrt(dx * dx + dy * dy);
      if (0.66 * radius <= d && d <= 0.92 * radius) ann.push([dx, dy]);
      else if (d < 0.42 * radius) corePts.push([dx, dy]);
      else if (0.95 * radius <= d && d <= 1.15 * radius) outPts.push([dx, dy]);
    }
  }
  const bandFraction = (mask: Uint8Array, pts: Array<[number, number]>, cx: number, cy: number): number => {
    let sum = 0;
    for (let k = 0; k < pts.length; k++) {
      const X = cx + pts[k][0];
      const Y = cy + pts[k][1];
      const idx = Y * w + X;
      if (idx >= 0 && idx < n) sum += mask[idx];
    }
    return sum / pts.length;
  };
  const pad = Math.round(radius * 1.3) + 1;
  const yTop = Math.floor(h * 0.15);
  const yBot = Math.floor(h * 0.95);
  interface Peak { x: number; y: number; s: number }
  const cfMap = new Float32Array(n);
  const scoreMap = new Float32Array(n);
  const cand = new Uint8Array(n);
  for (let y = yTop; y < yBot; y++) {
    for (let x = pad; x < w - pad; x++) {
      const i = y * w + x;
      const af = bandFraction(white, ann, x, y);
      const cf = bandFraction(core, corePts, x, y);
      const of = bandFraction(dark, outPts, x, y);
      cfMap[i] = cf;
      const score = af * 1.0 + cf * 0.8 + of * 0.5;
      scoreMap[i] = score;
      if (af > 0.55 && cf > 0.45 && score > 1.2) cand[i] = 1;
    }
  }
  const peaks: Peak[] = [];
  for (let y = yTop; y < yBot; y++) {
    for (let x = pad; x < w - pad; x++) {
      const i = y * w + x;
      if (!cand[i]) continue;
      let isMax = true;
      for (let yy = Math.max(yTop, y - 2); yy <= Math.min(yBot - 1, y + 2); yy++) {
        for (let xx = Math.max(pad, x - 2); xx <= Math.min(w - pad - 1, x + 2); xx++) {
          if (scoreMap[yy * w + xx] > scoreMap[i]) isMax = false;
        }
      }
      if (isMax) peaks.push({ x, y, s: scoreMap[i] });
    }
  }
  peaks.sort((a, b) => a.x - b.x);
  const nms: Peak[] = [];
  for (const p of peaks) {
    const last = nms[nms.length - 1];
    if (last && Math.abs(p.x - last.x) < radius * 1.3) {
      if (p.s > last.s) nms[nms.length - 1] = p;
    } else {
      nms.push(p);
    }
  }
  void cfMap;
  return nms.length;
}

/** 全帧画布：把 bitmap 画一次，后续按相对 ROI 读像素。 */
export class FrameProbe {
  private readonly canvas: OffscreenCanvas;
  private readonly ctx: OffscreenCanvasRenderingContext2D;
  readonly width: number;
  readonly height: number;

  constructor(bitmap: ImageBitmap) {
    this.width = bitmap.width;
    this.height = bitmap.height;
    this.canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('无法创建像素门画布');
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height);
    this.ctx = ctx;
  }

  /** 读取相对 ROI 的 RGBA（自动转像素坐标）。 */
  private cropRgba(box: RelBox): Uint8ClampedArray {
    const x = Math.floor(box[0] * this.width);
    const y = Math.floor(box[1] * this.height);
    const w = Math.max(1, Math.ceil(box[2] * this.width) - x);
    const h = Math.max(1, Math.ceil(box[3] * this.height) - y);
    return this.ctx.getImageData(x, y, w, h).data;
  }

  /** 敌方绿血条亮绿像素占比（对齐 cv2 HSV 区间 H40~95(0~180)、S≥110、V≥120）。 */
  greenFraction(): number {
    return greenFractionRgba(this.cropRgba(HP_BAR));
  }

  /** 三块卡面板暗像素占比（灰度<80）。 */
  panelDarkFractions(): number[] {
    return CARD_PANELS.map((box) => darkFractionRgba(this.cropRgba(box)));
  }

  /** 技能弹窗黄色「选择」按钮亮黄占比（cv2 HSV H15~35(0~180)、S≥120、V≥150）。 */
  skillButtonFraction(): number {
    return yellowFractionRgba(this.cropRgba(SKILL_BTN));
  }

  /** 3 张卡头像 tile（高斯模糊 + 32×32 归一化，RGB + HSV 两组特征）。 */
  cardTiles(): CardTile[] {
    return CARD_PORTRAITS.map((box) => {
      const sx = Math.floor(box[0] * this.width);
      const sy = Math.floor(box[1] * this.height);
      const sw = Math.max(1, Math.ceil(box[2] * this.width) - sx);
      const sh = Math.max(1, Math.ceil(box[3] * this.height) - sy);

      // 先在原分辨率裁剪上做高斯模糊（等价 PIL crop -> GaussianBlur(3)）
      const crop = new OffscreenCanvas(sw, sh);
      const cctx = crop.getContext('2d', { willReadFrequently: true });
      if (!cctx) throw new Error('无法创建 tile 画布');
      cctx.filter = `blur(${CARD_TILE_BLUR}px)`;
      cctx.imageSmoothingEnabled = true;
      cctx.drawImage(this.canvas, sx, sy, sw, sh, 0, 0, sw, sh);

      // 再降到 32×32（高质量 ≈ LANCZOS）
      const small = new OffscreenCanvas(CARD_TILE_SIZE, CARD_TILE_SIZE);
      const sctx = small.getContext('2d', { willReadFrequently: true });
      if (!sctx) throw new Error('无法创建 tile 缩放画布');
      sctx.imageSmoothingEnabled = true;
      sctx.imageSmoothingQuality = 'high';
      sctx.drawImage(crop, 0, 0, sw, sh, 0, 0, CARD_TILE_SIZE, CARD_TILE_SIZE);
      const data = sctx.getImageData(0, 0, CARD_TILE_SIZE, CARD_TILE_SIZE).data;

      const n = CARD_TILE_SIZE * CARD_TILE_SIZE;
      const rgb = new Float32Array(3 * n);
      const hsv = new Float32Array(3 * n);
      for (let p = 0; p < n; p++) {
        const r = data[p * 4];
        const g = data[p * 4 + 1];
        const b = data[p * 4 + 2];
        rgb[p] = r / 255;
        rgb[n + p] = g / 255;
        rgb[2 * n + p] = b / 255;
        const { h, s, v } = rgbToHsv(r, g, b);
        hsv[p] = h / 360;
        hsv[n + p] = s;
        hsv[2 * n + p] = v;
      }
      return { rgb, hsv };
    });
  }

  /** Boss 同伴槽位白盘数量（灰星核+暖白环+暗轮廓 ring 检测，diag_final2.py 定稿）。 */
  bossDiscCount(): number {
    const x0 = Math.floor(DISC_ROW[0] * this.width);
    const y0 = Math.floor(DISC_ROW[1] * this.height);
    const w = Math.max(1, Math.ceil(DISC_ROW[2] * this.width) - x0);
    const h = Math.max(1, Math.ceil(DISC_ROW[3] * this.height) - y0);
    const rgba = this.ctx.getImageData(x0, y0, w, h).data;
    return bossDiscCountFromRgba(rgba, w, h);
  }
}

/** 两个 tile 的差异：HSV 加权差（H 取环形差）与 RGB 平均绝对差取大者。 */
export function tileDiff(a: CardTile, b: CardTile): number {
  const n = a.rgb.length / 3;
  let dhSum = 0;
  let dsSum = 0;
  let dvSum = 0;
  let rgbSum = 0;
  for (let p = 0; p < n; p++) {
    const dh = Math.abs(a.hsv[p] - b.hsv[p]);
    dhSum += Math.min(dh, 1 - dh);
    dsSum += Math.abs(a.hsv[n + p] - b.hsv[n + p]);
    dvSum += Math.abs(a.hsv[2 * n + p] - b.hsv[2 * n + p]);
    rgbSum +=
      Math.abs(a.rgb[p] - b.rgb[p]) +
      Math.abs(a.rgb[n + p] - b.rgb[n + p]) +
      Math.abs(a.rgb[2 * n + p] - b.rgb[2 * n + p]);
  }
  const dHsv = (dhSum / n) * 0.7 + (dsSum / n) * 0.2 + (dvSum / n) * 0.1;
  const dRgb = rgbSum / (3 * n);
  return Math.max(dHsv, dRgb);
}
