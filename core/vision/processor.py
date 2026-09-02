import cv2
import numpy as np
from PIL import Image

from core.infra.logger import logger


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
    comps.sort(key=lambda c: (c[1], c[0]))  # 按行、列排，保证输出稳定

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
