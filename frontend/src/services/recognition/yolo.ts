/**
 * YOLOv8 版面检测（纯前端）—— 1:1 复刻后端 core/vision/crop.py。
 *
 * 只在「跟随识别」链路用：把游戏整帧切成 Title(0) / Item(1) / Name(2) 三类区域，
 * 后续 Title 走 rec-only OCR 判关卡、Name 走 rec-only OCR 取名、Item 走 DINO 提特征。
 * 首页单图识别 / 批量初始化都不经过这里。
 *
 * 与后端的对应关系：
 *   preprocess   -> yoloLetterbox   （等比缩放 + 居中补 114 灰边，/255，NCHW）
 *   postprocess  -> yoloPostprocess （阈值过滤 -> 反 letterbox 映射 -> cv2.dnn.NMSBoxes）
 *   detect       -> 由 Worker 持有 onnxruntime-web 会话（见 workers/recognition.worker.ts）
 *   crop_sections-> groupSections   （Title 取最后一个；Item/Name 按 x 升序取前 3）
 *
 * 注意阈值的两个来源：crop.py 里模块级 CONF_THRESH=0.1 是实际生效值
 * （predict 的默认参数 0.25 被显式覆盖），NMS 固定 0.4。
 */

export interface YoloDetection {
  /** 原图像素坐标，左上/右下，已裁剪到图像范围内 */
  box: [number, number, number, number];
  conf: number;
  cls: number;
}

export type Box = [number, number, number, number];

/** 类别下标 -> 语义（模型固定 3 类，见 core/vision/crop.py 的 CLASS_NAMES） */
export const YOLO_CLASS = { TITLE: 0, ITEM: 1, NAME: 2 } as const;

/** 对齐 core/vision/crop.py：CONF_THRESH / NMS_THRESH */
export const YOLO_CONF_THRESH = 0.1;
export const YOLO_NMS_THRESH = 0.4;
/** letterbox 补边灰度（uint8 114） */
export const YOLO_PAD_VALUE = 114;
/** 默认推理边长：桌面实测 1280 稳定、960 可用；显存/算力吃紧时上层可下调 */
export const YOLO_DEFAULT_IMGSZ = 1280;

export interface LetterboxInfo {
  /** 缩放比（原图 -> 模型空间） */
  scale: number;
  padX: number;
  padY: number;
  /** 模型输入边长（正方形） */
  size: number;
}

/**
 * letterbox 预处理：等比缩放 + 居中补灰边，再转 NCHW float32（仅 /255，无 ImageNet 归一化）。
 * 返回的 Float32Array 直接可喂给 [1,3,size,size] 的输入张量。
 */
export function yoloLetterbox(
    rgba: Uint8ClampedArray,
    w: number,
    h: number,
    size: number,
): { data: Float32Array; lb: LetterboxInfo; newW: number; newH: number } {
  const scale = Math.min(size / w, size / h);
  const newW = Math.max(1, Math.round(w * scale));
  const newH = Math.max(1, Math.round(h * scale));
  const padX = Math.floor((size - newW) / 2);
  const padY = Math.floor((size - newH) / 2);

  // 直接把原图绘制到 letterbox 画布上：canvas 一步完成「缩放 + 定位」，
  // 与后端 cv2.resize + canvas[pad:pad+new] = resized 等价（同样的双线性缩放 + 灰边）。
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('无法创建 YOLO 预处理画布');

  ctx.fillStyle = `rgb(${YOLO_PAD_VALUE},${YOLO_PAD_VALUE},${YOLO_PAD_VALUE})`;
  ctx.fillRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'low'; // 标准双线性，避免 high 的高阶滤波与 cv2 偏差

  // 用 ImageData 走一次中转，保证拿到的就是调用方给的那份像素（worker 里已经从 ImageBitmap 取过）
  const src = new ImageData(new Uint8ClampedArray(rgba), w, h);
  // createImageBitmap 在 worker 里可用，避免临时 canvas 再读一次
  const scratch = new OffscreenCanvas(w, h);
  const sctx = scratch.getContext('2d');
  if (!sctx) throw new Error('无法创建 YOLO 中转画布');
  sctx.putImageData(src, 0, 0);
  ctx.drawImage(scratch, 0, 0, w, h, padX, padY, newW, newH);

  const img = ctx.getImageData(0, 0, size, size).data;
  const px = size * size;
  const out = new Float32Array(3 * px);
  for (let p = 0; p < px; p++) {
    const s = p * 4;
    out[p] = img[s] / 255;
    out[px + p] = img[s + 1] / 255;
    out[2 * px + p] = img[s + 2] / 255;
  }
  return { data: out, lb: { scale, padX, padY, size }, newW, newH };
}

/** 两个 [x1,y1,x2,y2] 框的 IoU（cv2.dnn.NMSBoxes 用同一套定义）。 */
function iou(a: Box, b: Box): number {
  const ix1 = Math.max(a[0], b[0]);
  const iy1 = Math.max(a[1], b[1]);
  const ix2 = Math.min(a[2], b[2]);
  const iy2 = Math.min(a[3], b[3]);
  const iw = ix2 - ix1;
  const ih = iy2 - iy1;
  if (iw <= 0 || ih <= 0) return 0;
  const inter = iw * ih;
  const areaA = (a[2] - a[0]) * (a[3] - a[1]);
  const areaB = (b[2] - b[0]) * (b[3] - b[1]);
  const union = areaA + areaB - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * 贪心 NMS（跨类别，对齐 cv2.dnn.NMSBoxes：它不看类别，只按分数从高到低抑制重叠框）。
 * 输入需已按分数降序或内部会自行排序。
 */
function greedyNms(boxes: Box[], scores: number[], nmsThresh: number): number[] {
  const order = scores.map((_, i) => i).sort((a, b) => scores[b] - scores[a]);
  const suppressed = new Uint8Array(boxes.length);
  const keep: number[] = [];
  for (let i = 0; i < order.length; i++) {
    const idx = order[i];
    if (suppressed[idx]) continue;
    keep.push(idx);
    for (let j = i + 1; j < order.length; j++) {
      const other = order[j];
      if (suppressed[other]) continue;
      if (iou(boxes[idx], boxes[other]) > nmsThresh) suppressed[other] = 1;
    }
  }
  return keep;
}

/**
 * 后处理：YOLOv8 输出 [1, 4+nc, anchors] -> 原图坐标检测框（含 NMS）。
 *
 * 逐锚点取类别分数最大者（与后端 np.max / np.argmax 一致），过阈值后把
 * cx,cy,w,h 从「letterbox 模型空间」反算回原图，再转成 x1,y1,x2,y2 送 NMS。
 */
export function yoloPostprocess(
    out: Float32Array,
    dims: number[],
    origW: number,
    origH: number,
    lb: LetterboxInfo,
    confThresh: number = YOLO_CONF_THRESH,
    nmsThresh: number = YOLO_NMS_THRESH,
): YoloDetection[] {
  if (dims.length !== 3) throw new Error(`YOLO 输出维度异常: [${dims.join(',')}]`);
  const [, d1, d2] = dims;
  // [1, 4+nc, anchors] 是导出时的真实布局；这里额外兼容 [1, anchors, 4+nc]，
  // 避免以后换导出脚本时静默错位。
  const channelFirst = d1 <= 64;
  const channels = channelFirst ? d1 : d2;
  const anchors = channelFirst ? d2 : d1;
  const nc = channels - 4;
  if (nc <= 0) throw new Error(`YOLO 输出通道数异常: ${channels}`);

  const at = (anchor: number, ch: number) => channelFirst
      ? out[ch * anchors + anchor]
      : out[anchor * channels + ch];

  const boxes: Box[] = [];
  const scores: number[] = [];
  const classIds: number[] = [];

  for (let a = 0; a < anchors; a++) {
    let best = -Infinity;
    let bestCls = 0;
    for (let c = 0; c < nc; c++) {
      const v = at(a, 4 + c);
      if (v > best) {
        best = v;
        bestCls = c;
      }
    }
    if (best < confThresh) continue;

    const cx = (at(a, 0) - lb.padX) / lb.scale;
    const cy = (at(a, 1) - lb.padY) / lb.scale;
    const bw = at(a, 2) / lb.scale;
    const bh = at(a, 3) / lb.scale;
    boxes.push([cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2]);
    scores.push(best);
    classIds.push(bestCls);
  }

  const kept = greedyNms(boxes, scores, nmsThresh);
  const out2: YoloDetection[] = [];
  for (const i of kept) {
    const [x1, y1, x2, y2] = boxes[i];
    // 裁剪到原图范围内，避免越界（后端用同样的 round + clamp）
    const rx1 = Math.max(0, Math.round(x1));
    const ry1 = Math.max(0, Math.round(y1));
    const rx2 = Math.min(origW, Math.round(x2));
    const ry2 = Math.min(origH, Math.round(y2));
    if (rx2 - rx1 < 2 || ry2 - ry1 < 2) continue;
    out2.push({ box: [rx1, ry1, rx2, ry2], conf: scores[i], cls: classIds[i] });
  }
  return out2;
}

export interface YoloSections {
  /** 关卡标题条；未检出为 null */
  title: Box | null;
  /** 3 个精灵头像位，按 x 升序；不足补 null */
  items: (Box | null)[];
  /** 3 个精灵名字条，按 x 升序；不足补 null */
  names: (Box | null)[];
  counts: { title: number; item: number; name: number };
}

/**
 * 按类别归并 + 排序（复刻 crop.py::crop_sections_from_pil_by_YOLOv8）：
 *  - Title：取最后一个（后端是 for 循环覆盖赋值）
 *  - Item / Name：按 x1 升序取前 3，不足补 null
 * 二者各自独立按 x 排序，因此 items[i] 与 names[i] 是「第 i 个槽位」的配对（与后端一致）。
 */
export function groupSections(dets: YoloDetection[]): YoloSections {
  let title: Box | null = null;
  const items: Box[] = [];
  const names: Box[] = [];
  let titleCount = 0;
  for (const d of dets) {
    if (d.cls === YOLO_CLASS.TITLE) {
      title = d.box;
      titleCount++;
    } else if (d.cls === YOLO_CLASS.ITEM) {
      items.push(d.box);
    } else if (d.cls === YOLO_CLASS.NAME) {
      names.push(d.box);
    }
  }
  const byX = (a: Box, b: Box) => a[0] - b[0];
  items.sort(byX);
  names.sort(byX);

  const pad3 = (list: Box[]): (Box | null)[] => {
    const out: (Box | null)[] = [];
    for (let i = 0; i < 3; i++) out.push(list[i] ?? null);
    return out;
  };
  return {
    title,
    items: pad3(items),
    names: pad3(names),
    counts: { title: titleCount, item: items.length, name: names.length },
  };
}
