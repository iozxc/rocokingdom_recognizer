import cv2
import numpy as np
from PIL import Image

from logger import logger


def segment_icons(image_bytes, total_count=999):
    """
    将上传的图片二进制流切割成独立的小图标
    返回: List[PIL.Image]
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

    # --- 垂直边界查找 ---
    row_sum = np.sum(binary, axis=1)
    has_content_rows = np.where(row_sum > (binary.shape[1] * 0.05 * 255))[0]

    row_intervals = []
    if len(has_content_rows) > 0:
        start = has_content_rows[0]
        for i in range(1, len(has_content_rows)):
            if has_content_rows[i] - has_content_rows[i - 1] > 10:
                row_intervals.append((start, has_content_rows[i - 1]))
                start = has_content_rows[i]
        row_intervals.append((start, has_content_rows[-1]))

    logger.debug(f"segment_icons: 检测到 {len(row_intervals)} 个行区间")

    # --- 水平边界查找与切割 ---
    extracted_icons = []
    skipped_small = 0
    for r_start, r_end in row_intervals:
        if len(extracted_icons) >= total_count:
            break

        row_img_bin = binary[r_start:r_end, :]
        col_sum = np.sum(row_img_bin, axis=0)
        has_content_cols = np.where(col_sum > (row_img_bin.shape[0] * 0.05 * 255))[0]

        col_intervals = []
        if len(has_content_cols) > 0:
            c_start = has_content_cols[0]
            for i in range(1, len(has_content_cols)):
                if has_content_cols[i] - has_content_cols[i - 1] > 15:
                    col_intervals.append((c_start, has_content_cols[i - 1]))
                    c_start = has_content_cols[i]
            col_intervals.append((c_start, has_content_cols[-1]))

        logger.debug(f"segment_icons: 行[{r_start}:{r_end}] 检测到 {len(col_intervals)} 个列区间")

        for c_start, c_end in col_intervals:
            if len(extracted_icons) >= total_count:
                break
            if (c_end - c_start) < 10:
                skipped_small += 1
                continue

            # 裁剪并转换格式
            pad = 5
            y1, y2 = max(0, r_start - pad), min(img.shape[0], r_end + pad)
            x1, x2 = max(0, c_start - pad), min(img.shape[1], c_end + pad)

            icon_bgr = img[y1:y2, x1:x2]
            # OpenCV (BGR) -> PIL (RGB) 重要！
            icon_rgb = cv2.cvtColor(icon_bgr, cv2.COLOR_BGR2RGB)
            extracted_icons.append(Image.fromarray(icon_rgb))

    logger.debug(f"segment_icons: 分割完成, 有效图标={len(extracted_icons)}, 跳过过小图片={skipped_small}")
    return extracted_icons
