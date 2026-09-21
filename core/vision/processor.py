import cv2
import numpy as np
from PIL import Image

from core.infra.logger import logger


def _sort_components_row_major(comps):
    """把连通域按“从左到右、从上到下”的阅读顺序排序。

    直接按 bbox 的 (y, x) 排序并不可靠：同一排图标的 bbox 顶部高度往往略有差异
    （有的精灵头顶有高出来的装饰/名字牌），会把同一排的列顺序打乱。
    这里先按中心 y 聚类成“行”，行内再按中心 x 升序，得到与截图一致的网格顺序。
    """
    if len(comps) <= 1:
        return comps

    items = [(y + h / 2.0, x + w / 2.0, (x, y, w, h, area)) for (x, y, w, h, area) in comps]
    items.sort(key=lambda t: (t[0], t[1]))

    heights = [c[3] for c in comps]
    heights_sorted = sorted(heights)
    median_h = heights_sorted[len(heights_sorted) // 2] if heights_sorted else 0.0

    gaps = [
        items[i + 1][0] - items[i][0]
        for i in range(len(items) - 1)
        if items[i + 1][0] > items[i][0]
    ]
    median_gap = float(np.median(gaps)) if gaps else 0.0

    # 容差：同行内中心 y 波动一般远小于行间距。取行高一半与行距一半的较大者，
    # 避免同一排因 ±10px 的高度差被拆成两行，同时仍能区分相邻两排。
    tolerance = max(median_h * 0.6, median_gap * 0.45)

    rows = []
    for cy, cx, comp in items:
        placed = False
        for row in rows:
            if abs(cy - row["mean_y"]) <= tolerance:
                row["items"].append((cy, cx, comp))
                row["mean_y"] = sum(item[0] for item in row["items"]) / len(row["items"])
                placed = True
                break
        if not placed:
            rows.append({"mean_y": cy, "items": [(cy, cx, comp)]})

    rows.sort(key=lambda r: r["mean_y"])
    ordered = []
    for row in rows:
        row["items"].sort(key=lambda t: t[1])
        ordered.extend(comp for _, _, comp in row["items"])
    return ordered


def segment_icons(image_bytes, total_count=999):
    """
    将上传的图片二进制流切割成独立的小图标
    返回: List[PIL.Image]

    方案：连通域(connected components)。先二值化，再轻度膨胀把「深色圆环 + 内部精灵」
    连为一体，然后按连通域聚类，过滤掉噪声碎片，最后按面积中位数筛掉过小残块。
    相比“行/列投影 + 固定间隔”，连通域更能适配不规则/不对齐的图鉴排布，
    不会因为某两行/两列间隔过小（如 ≤10px / ≤15px）就把相邻图标并进一个包围盒。
    """
    logger.debug(f"segment_icons: 开始分割, 输入字节数={len(image_bytes)}, total_count={total_count}")

    # 1. 将二进制流转为 OpenCV 格式
    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        logger.warning("segment_icons: 图片解码失败，返回空列表")
        return []

    logger.debug(f"segment_icons: 图片尺寸={img.shape[1]}x{img.shape[0]}")

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    # 二值化
    _, binary = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY_INV)

    # --- 轻度膨胀：让“深色圆环 + 内部精灵”连成一块，避免一个图标被拆成多个碎块 ---
    short_side = min(img.shape[0], img.shape[1])
    kernel_size = max(2, int(short_side / 240))
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_size, kernel_size))
    dil = cv2.dilate(binary, kernel, iterations=1)

    # --- 连通域聚类 ---
    num, _labels, stats, _centroids = cv2.connectedComponentsWithStats(dil, connectivity=8)

    comps = []
    for i in range(1, num):
        x, y, w, h, area = stats[i]
        comps.append((x, y, w, h, area))

    if not comps:
        logger.debug("segment_icons: 未检测到任何连通域")
        return []

    areas = np.array([c[4] for c in comps], dtype=float)
    max_area = float(areas.max()) if areas.size else 0.0

    # 参考尺寸只从“明显是图标”的大块里取（面积 >= 最大面积*15%），
    # 避免被大量噪声碎片把中位面积拉低、从而放过细小碎片。
    big = [c for c in comps if c[4] >= max_area * 0.15] if max_area > 0 else []
    if not big:
        logger.debug("segment_icons: 未检测到有效图标")
        return []
    ref_w = float(np.median([c[2] for c in big]))
    ref_h = float(np.median([c[3] for c in big]))

    # 面积阈 + 尺寸阈。尺寸阈用“宽高都 >= 参考尺寸*0.45”，
    # 专门过滤掉从图标上脱落的细小碎片（如 19x14px 的小暗块）。
    comps = [
        c for c in comps
        if c[4] >= max_area * 0.12
        and c[2] >= ref_w * 0.45
        and c[3] >= ref_h * 0.45
    ]
    comps = _sort_components_row_major(comps)  # 按行聚类、行内按 x 排序，与截图网格顺序一致

    extracted_icons = []
    for x, y, w, h, _area in comps:
        if len(extracted_icons) >= total_count:
            break
        # 裁剪并转换格式
        pad = 5
        y1, y2 = max(0, y - pad), min(img.shape[0], y + h + pad)
        x1, x2 = max(0, x - pad), min(img.shape[1], x + w + pad)
        icon_bgr = img[y1:y2, x1:x2]
        # OpenCV (BGR) -> PIL (RGB) 重要！
        icon_rgb = cv2.cvtColor(icon_bgr, cv2.COLOR_BGR2RGB)
        extracted_icons.append(Image.fromarray(icon_rgb))

    logger.debug(
        f"segment_icons: 分割完成, 有效图标={len(extracted_icons)}"
    )
    return extracted_icons


def segment_icons_by_name_anchors(image_bytes, name_items, k_diam=4.2, k_gap=0.13,
                                  pad=5, nh_tol=0.35):
    """名字锚定几何切割：复杂背景"圆形头像 + 下方居中名字"界面的兜底分割。

    不做前景分割、不依赖任何检测模型，只利用这类 UI 的硬几何约束，由 OCR 名字框反推头像：
      - 头像中心 x = 名字框中心 x（名字水平居中于头像）；
      - 尺度取"同行名字字高"中位数（同字号，不受名字字数多少影响）：头像直径 D ≈ k_diam * 字高；
      - 头像中心 y = 名字中心 y 上移 (D/2 + k_gap*D + 字高/2)。
    返回 List[PIL.Image]，顺序与 name_items 完全一致（即与 OCR 名字一一对齐）。
    """
    if not name_items:
        return []

    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        logger.warning("segment_icons_by_name_anchors: 图片解码失败，返回空列表")
        return []
    img_h, img_w = img.shape[:2]

    nh_sorted = sorted(float(it.get("nh", 0) or 0) for it in name_items)
    nh_med = nh_sorted[len(nh_sorted) // 2]
    if nh_med <= 0:
        logger.debug("segment_icons_by_name_anchors: 名字字高异常，返回空列表")
        return []

    # 丢弃字高离群的噪声文字块，保留与同行主字号一致的名字
    items = [it for it in name_items
             if abs(float(it.get("nh", 0)) - nh_med) <= nh_tol * nh_med]
    if not items:
        items = list(name_items)

    diam = k_diam * nh_med
    half = diam / 2.0
    logger.debug(
        f"segment_icons_by_name_anchors: 名字数={len(name_items)}, 采用={len(items)}, "
        f"字高中位={nh_med:.1f}, 推算头像直径={diam:.1f}"
    )

    extracted = []
    for it in items:
        cx = float(it["cx"])
        name_cy = float(it["cy"])
        nh = float(it.get("nh", nh_med))
        head_cy = name_cy - (half + k_gap * diam + nh / 2.0)

        x1 = int(round(cx - half - pad))
        x2 = int(round(cx + half + pad))
        y1 = int(round(head_cy - half - pad))
        y2 = int(round(head_cy + half + pad))
        x1, x2 = max(0, x1), min(img_w, x2)
        y1, y2 = max(0, y1), min(img_h, y2)
        if x2 <= x1 or y2 <= y1:
            continue

        icon_bgr = img[y1:y2, x1:x2]
        extracted.append(Image.fromarray(cv2.cvtColor(icon_bgr, cv2.COLOR_BGR2RGB)))

    logger.debug(f"segment_icons_by_name_anchors: 切割完成, 输出图标={len(extracted)}")
    return extracted

def is_blank_icon(pil_img, std_max=42.0, fg_dom_min=0.82, white_frac_max=0.97):
    """空槽 / 空白裁剪判定：纯色（均匀绿底带淡「?」、或纯白）的图位不是精灵。

    背景：纯色空槽（游戏里的「?」占位符）切成图位后，整块几乎都是同一个绿色圆角
    底块，DINO 特征会和大量立绘共享的绿色背景高相似，反而得到 90%+ 的错误高分。
    本函数在「提特征之前」就识别这类空槽，用两个互补判据：
      - 灰度标准差 std：纹理量。空槽是大面积纯色，std 极低；真精灵有眼睛/描边/
        多色块，std 明显更高。
      - 前景主色占比 dominant_fg：只在「非白像素」里统计同一量化颜色（每通道 4 级，
        共 64 桶）的占比，剔除白色 padding/圆角背景；空槽的非白部分几乎全是同一种
        绿（≈0.99），真精灵则被多色精灵打散。
    两个条件用 AND 连接，避免把「颜色很简单的真精灵」误杀（这类精灵 std 稍高或
    主色占比稍低）。纯白占比极高时直接视为空槽。
    返回 (is_blank, info)。
    """
    arr = np.asarray(pil_img.convert("RGB"), dtype=np.uint8)
    gray = (
        arr[:, :, 0].astype(np.int32) * 4899
        + arr[:, :, 1].astype(np.int32) * 9617
        + arr[:, :, 2].astype(np.int32) * 1868
    ) >> 14
    gray = gray.astype(np.float64)
    std = float(gray.std())
    white_frac = float((gray > 235).mean())
    if white_frac > white_frac_max:
        return True, {"std": std, "dominant_fg": 1.0, "white": white_frac}

    q = arr.astype(np.uint32) >> 6
    keys = (q[:, :, 0] << 4) | (q[:, :, 1] << 2) | q[:, :, 2]
    fg = gray < 235
    fg_n = int(fg.sum())
    if fg_n > 16:
        bins = np.bincount(keys[fg].ravel(), minlength=64)
        dominant_fg = float(bins.max()) / float(fg_n)
    else:
        dominant_fg = 1.0
    is_blank = (std < std_max) and (dominant_fg > fg_dom_min)
    return is_blank, {"std": std, "dominant_fg": dominant_fg, "white": white_frac}


def _placeholder_stats(pil_img):
    """空槽/占位符的单图统计：std、白色占比、前景主色占比、平均饱和度、灰度像素占比。

    灰度公式与前端一致 (4899R+9617G+1868B)>>14；饱和度用 HSV 简化的 chroma/max。
    """
    arr = np.asarray(pil_img.convert("RGB"), dtype=np.int32)
    r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
    gray = ((r * 4899 + g * 9617 + b * 1868) >> 14).astype(np.float64)
    std = float(gray.std())
    white_frac = float((gray > 235).mean())

    q = arr.astype(np.uint32) >> 6
    keys = (q[:, :, 0] << 4) | (q[:, :, 1] << 2) | q[:, :, 2]
    fg = gray < 235
    fg_n = int(fg.sum())
    if fg_n > 16:
        dominant_fg = float(np.bincount(keys[fg].ravel(), minlength=64).max()) / float(fg_n)
    else:
        dominant_fg = 1.0

    mx = arr.max(2).astype(np.float32)
    mn = arr.min(2).astype(np.float32)
    chroma = mx - mn
    nonwhite = mn < 240
    if nonwhite.any():
        sat = np.where(mx > 0, chroma / np.maximum(mx, 1.0), 0.0)
        mean_sat = float(sat[nonwhite].mean())
        gray_frac = float((chroma[nonwhite] < 18).mean())
    else:
        mean_sat, gray_frac = 0.0, 1.0

    return {
        "std": std,
        "white": white_frac,
        "dominant_fg": dominant_fg,
        "mean_sat": mean_sat,
        "gray_frac": gray_frac,
    }


def _placeholder_fingerprint(pil_img, size=48):
    """缩放到固定尺寸的灰度零均值单位向量，用来比对两个图位是否“同一个占位符”。"""
    g = np.asarray(
        pil_img.convert("L").resize((size, size), Image.BILINEAR),
        dtype=np.float32,
    ).reshape(-1)
    g = g - g.mean()
    norm = float(np.linalg.norm(g))
    return g / norm if norm > 1e-6 else g


def detect_placeholder_icons(
    icons,
    std_max=42.0,
    fg_dom_min=0.82,
    white_frac_max=0.97,
    dup_thr=0.90,
    mean_sat_gate=0.18,
    gray_frac_gate=0.42,
):
    """批量判定空槽/占位符（游戏里的「?」未遇见占位），返回 (flags, infos)。

    比 is_blank_icon（只能认纯色平铺槽）更全，多一层“重复占位符”检测：

    1) 单图纯色平铺：均匀绿底「?」、纯白等，几乎无纹理、前景主色高度集中。
    2) 批量重复占位符：图鉴/背包里的“未遇见”是同一个灰色「?」布袋，同排会重复出现，
       归一化缩略图几乎完全一致（实测相关系数 ≈0.99）；而不同精灵两两不同（实测 ≤0.77）。
       再叠加“低信息量（去饱和/高灰度）”门槛，避免把重复出现的同色真精灵误判。
       实测：灰色布袋 mean_sat≈0.07、gray_frac≈0.53；真彩精灵 mean_sat 更高、gray_frac
       更低；最灰的真精灵（棋棋_黑子等）虽然也去饱和，但同屏只出现一只，不会被当成重复。
    """
    n = len(icons)
    flags = [False] * n
    reasons = [""] * n
    infos = []
    for im in icons:
        try:
            st = _placeholder_stats(im)
        except Exception:
            st = {"std": 0.0, "white": 0.0, "dominant_fg": 0.0,
                  "mean_sat": 0.0, "gray_frac": 0.0}
        infos.append(st)

    # 1) 单图纯色平铺
    for i in range(n):
        st = infos[i]
        if st["white"] > white_frac_max or (st["std"] < std_max and st["dominant_fg"] > fg_dom_min):
            flags[i] = True
            reasons[i] = "uniform"

    # 2) 批量重复占位符（同一排的灰色「?」布袋）
    if n >= 2:
        try:
            vec = np.array([_placeholder_fingerprint(im) for im in icons], dtype=np.float32)
            sim = vec @ vec.T
            np.fill_diagonal(sim, -1.0)
            for i in range(n):
                if flags[i]:
                    continue
                st = infos[i]
                low_info = (st["mean_sat"] < mean_sat_gate) or (st["gray_frac"] > gray_frac_gate)
                if not low_info:
                    continue
                if int((sim[i] >= dup_thr).sum()) >= 1:
                    flags[i] = True
                    reasons[i] = "duplicate"
        except Exception:
            logger.warning("detect_placeholder_icons: 重复占位符检测异常，已跳过", exc_info=True)

    return flags, infos, reasons
