import cv2
import numpy as np
import easyocr
import os
import re

# ================= 配置区域 =================
INPUT_DIR = 'assets/pic'
OUTPUT_DIR = 'extracted_icons'
# 确保输出目录存在
if not os.path.exists(OUTPUT_DIR):
    os.makedirs(OUTPUT_DIR)

# 初始化 OCR，识别简体中文和英文
print("正在初始化 EasyOCR (首次运行需下载模型)...")
reader = easyocr.Reader(['ch_sim', 'en'])


def cv_imread(file_path):
    """支持中文路径的读取"""
    cv_img = cv2.imdecode(np.fromfile(file_path, dtype=np.uint8), cv2.IMREAD_COLOR)
    return cv_img


def cv_imwrite(file_path, img):
    """支持中文路径的保存 (UTF-8)"""
    ext = os.path.splitext(file_path)[1]
    result, nparray = cv2.imencode(ext, img)
    if result:
        nparray.tofile(file_path)
        return True
    return False


def clean_name(text):
    """提取纯中文或合法字符，过滤掉ID数字和杂质"""
    # 移除数字、特殊符号，只保留中文、字母
    text = re.sub(r'[^\u4e00-\u9fa5a-zA-Z]', '', text)
    return text.strip()


def process_file(file_path):
    print(f"正在处理: {file_path}")
    img = cv_imread(file_path)
    if img is None:
        return

    h, w = img.shape[:2]

    # 1. OCR 识别所有文字和位置
    # paragraph=False 获取精确的单行位置
    results = reader.readtext(img, detail=1)

    # 2. 识别圆形图标 (图标都在右侧)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (7, 7), 2)

    # 使用霍夫圆变换定位头像
    circles = cv2.HoughCircles(
        blurred, cv2.HOUGH_GRADIENT, dp=1.2, minDist=60,
        param1=50, param2=35, minRadius=30, maxRadius=100
    )

    if circles is None:
        print(f"  警告: 在 {file_path} 中未检测到圆形图标")
        return

    circles = np.uint16(np.around(circles))

    count = 0
    for circle in circles[0, :]:
        cx, cy, r = circle

        # 只处理位于图片右侧 60% 区域的圆
        if cx < w * 0.6:
            continue

        # 3. 匹配圆左侧的名字
        # 逻辑：寻找 Y 轴坐标与圆心最接近的非数字文本
        best_name = ""
        min_dist = 9999

        for (bbox, text, prob) in results:
            # bbox 为 [[x1,y1], [x2,y1], [x2,y2], [x1,y2]]
            text_y_center = (bbox[0][1] + bbox[2][1]) / 2
            text_x_center = (bbox[0][0] + bbox[1][0]) / 2

            # 名字应该在圆的左边，且高度差较小
            if text_x_center < cx and abs(text_y_center - cy) < r:
                name = clean_name(text)
                if name and not name.isdigit():
                    dist = abs(text_y_center - cy)
                    if dist < min_dist:
                        min_dist = dist
                        best_name = name

        # 4. 裁剪并保存
        if best_name:
            # 稍微向外扩一点边界（5像素）
            margin = 5
            y1, y2 = max(0, cy - r - margin), min(h, cy + r + margin)
            x1, x2 = max(0, cx - r - margin), min(w, cx + r + margin)

            icon_crop = img[y1:y2, x1:x2]

            if icon_crop.size > 0:
                save_path = os.path.join(OUTPUT_DIR, f"{best_name}.png")
                if cv_imwrite(save_path, icon_crop):
                    print(f"  [成功] 提取图标: {best_name}")
                    count += 1

    print(f"文件处理完成，共提取 {count} 个图标。")


def main():
    # 处理 0.png 到 24.png
    for i in range(25):
        filename = f"{i}.png"
        path = os.path.join(INPUT_DIR, filename)
        if os.path.exists(path):
            process_file(path)
        else:
            print(f"跳过: {path} 不存在")


if __name__ == "__main__":
    main()