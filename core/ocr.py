import easyocr
import os
import torch
import re
import cv2
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

    def recognize_text(self, image_path):
        """
        识别图片中的文字
        :param image_path: 图片的绝对路径
        :return: 识别出的合并字符串，如果没有文字则返回 None
        """
        if not os.path.exists(image_path):
            print(f"Error: 文件不存在 {image_path}")
            return None

        try:
            # 读取图片
            img = cv2.imread(image_path)
            if img is None: return None

            # --- 预处理开始 ---
            # 1. 转为灰度图
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            # 2. 放大一倍（对于小文字非常有效）
            gray = cv2.resize(gray, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
            # --- 预处理结束 ---

            # readtext 返回一个列表，每个元素是: (边界框, 内容, 置信度)
            results = self.reader.readtext(gray)

            if not results:
                return None

            # 提取所有文本内容并拼接
            # result[1] 是文本内容
            full_text = "".join([res[1] for res in results]).strip()
            full_text = clean_ocr_text(full_text)
            # 如果拼接后是空字符串，也返回 None
            if not full_text:
                return None

            return full_text

        except Exception as e:
            print(f"OCR 识别出错: {e}")
            return None


# --- 下面是独立运行的测试逻辑 ---
if __name__ == "__main__":
    # 实例化引擎（建议在应用启动时只实例化一次，因为加载模型较慢）
    ocr = OCREngine()

    # 测试路径
    test_image = "../assets/pic/ocr_test.png"  # 替换为你自己的图片路径

    if os.path.exists(test_image):
        result = ocr.recognize_text(test_image)
        if result:
            print(f"识别成功: {result}")
        else:
            print("未识别到文字，返回内容为 None")
    else:
        print(f"请准备一张名为 {test_image} 的图片进行测试")