import cv2
import easyocr
import os

import numpy as np
import torch
import re
import warnings

# 1. 忽略 Torch 的弃用警告和用户警告
warnings.filterwarnings("ignore", category=UserWarning)
warnings.filterwarnings("ignore", category=FutureWarning)

# 2. 设置环境变量屏蔽 EasyOCR 的自带控制台打印 (Using CPU... 那行)
os.environ["EASYOCR_MODULE_LOG"] = "False"


def clean_ocr_text(text):
    if not text:
        return ""
    # 1. 过滤掉所有特殊符号，只保留中文、数字和英文
    # 这一步会把 # 删掉
    cleaned = re.sub(r'[^\u4e00-\u9fa5a-zA-Z0-9]', '', text)
    return cleaned


class OCREngine:
    def __init__(self):
        """
        初始化 OCR 引擎
        自动检测是否支持 GPU (CUDA)
        """
        self.use_gpu = torch.cuda.is_available()
        # 初始化读取器，支持简体中文和英文
        # 模型文件通常存放在 ~/.EasyOCR/model 下
        self.reader = easyocr.Reader(['ch_sim', 'en'], gpu=self.use_gpu)

    def recognize_bottom_text(self, image_path, y_tolerance=30, min_confidence=0.3):
        """
        精确提取最底部的名字行，并过滤掉已知的干扰词
        """
        # 1. 定义干扰词黑名单 (只要包含这些字的块都会被踢除)
        blacklist = ["额外", "掉落", "获取", "碎片", "额外掉落", "额外获取"]

        if not os.path.exists(image_path):
            return []

        results = self.reader.readtext(image_path)
        if not results:
            return []

        blocks = []
        for res in results:
            box, text, conf = res
            if conf < min_confidence: continue

            # 去掉空格和特殊符号，方便匹配
            clean_raw = re.sub(r'\s+', '', text)

            # --- 核心逻辑：黑名单过滤 ---
            # 如果识别到的词在黑名单里，或者黑名单里的词在识别结果里，跳过
            is_noise = False
            for noise in blacklist:
                if noise in clean_raw:
                    is_noise = True
                    break
            if is_noise: continue

            # 只要没被过滤，计算中心点
            center_x = (box[0][0] + box[1][0]) / 2
            center_y = (box[0][1] + box[2][1]) / 2

            # 最终清洗（只留中英数）
            cleaned = re.sub(r'[^\u4e00-\u9fa5a-zA-Z0-9]', '', clean_raw)
            if cleaned:
                blocks.append({
                    "text": cleaned,
                    "x": center_x,
                    "y": center_y
                })

        if not blocks: return []

        # 2. 按 Y 坐标进行行聚类（从下往上找）
        lines = []
        # 按 Y 坐标降序（值越大代表在图片越底部）
        blocks.sort(key=lambda b: b['y'], reverse=True)

        for b in blocks:
            found_line = False
            for line in lines:
                avg_y = sum(item['y'] for item in line) / len(line)
                if abs(b['y'] - avg_y) < y_tolerance:
                    line.append(b)
                    found_line = True
                    break
            if not found_line:
                lines.append([b])

        # 3. 提取目标行
        # 经过黑名单过滤后，最底部的这一行（lines[0]）几乎确定就是名字行
        target_line = lines[0]

        # 4. 按 X 坐标从左到右排序，对齐分割索引
        target_line.sort(key=lambda b: b['x'])

        return [b['text'] for b in target_line]

    def recognize_single_bottom_text(self, image_path, y_tolerance=30, min_confidence=0.3):
        """
        专门针对单图优化的识别：过滤残缺干扰，优先定位正下方名字
        """
        # 扩展黑名单：加入可能出现的残缺单字
        blacklist = ["额外", "掉落", "获取", "碎片", "额", "外", "掉", "落", "碎", "片", "夕"]

        if not os.path.exists(image_path):
            return None

        # 获取图片宽度用于计算中心距离
        from PIL import Image
        with Image.open(image_path) as img:
            img_w, img_h = img.size
        center_x = img_w / 2

        results = self.reader.readtext(image_path)
        if not results:
            return None

        blocks = []
        for res in results:
            box, text, conf = res
            if conf < min_confidence: continue

            # 基础清洗
            clean_raw = re.sub(r'\s+', '', text)

            # 1. 黑名单增强过滤
            # 如果识别出的词包含黑名单词汇，或者是黑名单里的单字，直接跳过
            if any(noise in clean_raw for noise in blacklist):
                continue

            # 计算重心
            cur_x = (box[0][0] + box[1][0]) / 2
            cur_y = (box[0][1] + box[2][1]) / 2

            # 2. 距离中心点的偏移量（越小越可能是名字）
            dist_to_center = abs(cur_x - center_x)

            # 最终清洗
            cleaned = re.sub(r'[^\u4e00-\u9fa5a-zA-Z0-9]', '', clean_raw)
            if cleaned:
                blocks.append({
                    "text": cleaned,
                    "x": cur_x,
                    "y": cur_y,
                    "dist": dist_to_center,
                    "conf": conf
                })

        if not blocks:
            return None

        # 3. 核心排序算法：综合 [Y坐标] 和 [水平中心偏移]
        # 我们寻找：位置最靠下 且 离中心最近 的块
        # 我们可以通过给 Y 坐标最高的权重，给中心偏移量一定的负权重来筛选

        # 先按 Y 降序排序（最底部的在前）
        blocks.sort(key=lambda b: b['y'], reverse=True)

        # 取出最底部的块作为候选
        best_block = blocks[0]

        # 4. 容错逻辑：检查是否有跟它 Y 轴差不多，但离中心更近的块
        # 因为“额夕”这种残片有时会因为切图原因显得比名字还靠下一点点
        for i in range(1, len(blocks)):
            # 如果另一个块也在底部区域（Y差距在 50 像素内）
            if abs(blocks[i]['y'] - best_block['y']) < 50:
                # 但是另一个块离中心点显著更近，则它更可能是名字
                if blocks[i]['dist'] < best_block['dist'] * 0.5:
                    best_block = blocks[i]

        # 5. 寻找同一行可能被切断的名字片段（比如“香草” “甜甜”）
        target_line = [best_block]
        for b in blocks:
            if b == best_block: continue
            if abs(b['y'] - best_block['y']) < y_tolerance:
                target_line.append(b)

        # 按 X 排序并合并
        target_line.sort(key=lambda b: b['x'])
        final_name = "".join([b['text'] for b in target_line])

        return final_name if final_name else None


# --- 下面是独立运行的测试逻辑 ---
if __name__ == "__main__":
    # 实例化引擎（建议在应用启动时只实例化一次，因为加载模型较慢）
    ocr = OCREngine()

    # 测试路径
    # test_image = "../assets/pic/ocr_test3.png"  # 替换为你自己的图片路径

    # if os.path.exists(test_image):
    #     result = ocr.recognize_bottom_text(test_image)
    #     if result:
    #         print(f"识别成功: {result}")
    #     else:
    #         print("未识别到文字，返回内容为 None")
    # else:
    #     print(f"请准备一张名为 {test_image} 的图片进行测试")

    list_name = ["../debug_caps/cropped_results/2_cards.png",
                 "../debug_caps/cropped_results/3_cards.png",
                 "../debug_caps/cropped_results/4_cards.png",
                 "../debug_caps/cropped_results/5_cards.png"]

    # list_name2 = ["../debug_caps/cropped_results/2_title.png",
    #              "../debug_caps/cropped_results/3_title.png",
    #              "../debug_caps/cropped_results/4_title.png",
    #              "../debug_caps/cropped_results/5_title.png"]
    #

    for name in list_name:
        result = ocr.recognize_bottom_text(name)
        print(result)
