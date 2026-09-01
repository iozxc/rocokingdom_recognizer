"""【徽章试炼】关卡判定——关卡标题图像分类器（≠ 开放世界大地图识别）。

徽章试炼每个关卡（图1-3，map1/map2/map3）顶部有关卡标题；本模块对该标题
图像提特征并与标题特征库比对，判定当前是第几关，作为标题 OCR + 特征字
（core/infra/capture.match_scene_unique_char）识别失败时的回退方案。

注意：本模块与开放世界跑图的小地图定位（core/vision/world_localizer.py，
开放世界大地图识别）完全是两回事——这里分类的是试炼关卡标题，不是大世界位置。
"""
import onnxruntime as ort
import numpy as np
import cv2
import os
import pickle
from core.infra.logger import logger
import time
from PIL import Image


class StageClassifier:
    def __init__(self, onnx_model_path, database_path=None):
        """
        :param onnx_model_path: 特征提取 ONNX 模型路径（如 dino_backbone.onnx）
        :param database_path: 关卡标题特征库 pkl 路径
        """
        logger.info(f"初始化StageClassifier: 模型={onnx_model_path}, 特征库={database_path}")

        # 1. 加载 ONNX 模型
        if not os.path.exists(onnx_model_path):
            logger.error(f"ONNX模型文件缺失: {onnx_model_path}")
            raise FileNotFoundError(f"ONNX 模型文件缺失：{onnx_model_path}")

        # 优化选项：仅使用 CPU 运行
        self.session = ort.InferenceSession(onnx_model_path, providers=['CPUExecutionProvider'])
        logger.info("StageClassifier ONNX模型加载成功 (CPU)")

        # 从 ONNX 输入推断输入尺寸（resnet=224, dino=518 自动适配）
        self.input_size = 224
        try:
            in_shape = self.session.get_inputs()[0].shape
            if len(in_shape) == 4 and isinstance(in_shape[2], int) and isinstance(in_shape[3], int):
                self.input_size = int(in_shape[2])
        except Exception:
            pass
        logger.info(f"StageClassifier 输入尺寸: {self.input_size}")

        # 2. 预处理参数 (必须与 Torchvision 的 Normalize 一致)
        self.mean = np.array([0.485, 0.456, 0.406], dtype=np.float32).reshape((1, 1, 3))
        self.std = np.array([0.229, 0.224, 0.225], dtype=np.float32).reshape((1, 1, 3))

        self.databases = {}
        if database_path:
            self.load_db(database_path)
        else:
            logger.warning("StageClassifier初始化时未提供特征库路径，需后续调用load_db")

    def load_db(self, path):
        """加载经过转换后的 pkl 特征库"""
        logger.debug(f"开始加载特征库: {path}")
        try:
            with open(path, 'rb') as f:
                self.databases = pickle.load(f)
            feat_count = len(self.databases.get("features", []))
            logger.info(f"--- 成功加载特征库 (NumPy): {path}, 特征数={feat_count} ---")
        except Exception as e:
            logger.error(f"加载特征库失败 {path}: {e}", exc_info=True)
            raise

    def preprocess(self, img):
        """
        手动实现 torchvision.transforms 的逻辑
        """
        # ==========新增输入防御校验==========
        if img is None:
            raise ValueError("preprocess: 输入图像为 None")

        img_bgr = None
        if isinstance(img, str):
            # 如果是路径，读取图片；如果是 PIL 对象，转为 numpy
            img_data = np.fromfile(img, dtype=np.uint8)
            img_bgr = cv2.imdecode(img_data, cv2.IMREAD_COLOR)
            if img_bgr is None:
                raise RuntimeError(f"preprocess: 文件读取失败 {img}")
        elif isinstance(img, Image.Image):
            # PIL Image 转 numpy (RGB)
            arr = np.array(img)
            if arr.dtype == object:
                raise RuntimeError("preprocess: PIL对象无效，np.array得到object数组")
            img_bgr = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
        else:
            raise TypeError(f"preprocess: 不支持的输入类型 {type(img)}, 需要str路径或PIL.Image")

        # 1. 统一转为 RGB 格式
        img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)

        # 2. 保持长宽比缩放 + 居中 pad 到输入尺寸(防标题等长条图变形)。
        #    resnet=224, dino=518 自动适配；与 title 特征库生成时的 pad_resize 一致。
        sz = self.input_size
        h, w = img_rgb.shape[:2]
        scale = sz / max(h, w)
        nh, nw = max(1, int(h * scale)), max(1, int(w * scale))
        img_resized = cv2.resize(img_rgb, (nw, nh), interpolation=cv2.INTER_LINEAR)
        top = (sz - nh) // 2
        left = (sz - nw) // 2
        pad_color = (255, 255, 255)
        img_resized = cv2.copyMakeBorder(
            img_resized, top, sz - nh - top, left, sz - nw - left,
            cv2.BORDER_CONSTANT, value=pad_color,
        )

        # 3. ToTensor: 转为 float32 并缩放到 [0, 1]
        img_float = img_resized.astype(np.float32) / 255.0

        # 4. Normalize: (img - mean) / std
        img_norm = (img_float - self.mean) / self.std

        # 5. HWC 转 CHW 并增加 Batch 维度: (1, 3, sz, sz)
        img_final = img_norm.transpose(2, 0, 1)[np.newaxis, :]
        return img_final.astype(np.float32)

    def get_feature(self, img):
        """提取特征并进行 L2 归一化"""
        t0 = time.perf_counter()
        input_tensor = self.preprocess(img)

        # 执行 ONNX 推理
        ort_inputs = {self.session.get_inputs()[0].name: input_tensor}
        ort_outs = self.session.run(None, ort_inputs)

        # 提取结果并打平
        feature = ort_outs[0].flatten()

        # L2 归一化 (等同于 feature / feature.norm(p=2))
        norm = np.linalg.norm(feature)
        if norm > 0:
            feature = feature / norm

        elapsed = (time.perf_counter() - t0) * 1000
        logger.debug(f"地图分类特征提取: 维度={len(feature)}, 耗时={elapsed:.1f}ms")
        return feature

    def match(self, img_pil, fallback_map="map1"):
        t0 = time.perf_counter()
        logger.debug("开始地图分类匹配")

        try:
            query_feat = self.get_feature(img_pil)
        except Exception as e:
            logger.error(f"StageClassifier.match 输入图片处理失败: {e}", exc_info=True)
            return fallback_map

        db = self.databases

        if not db or "features" not in db or len(db["features"]) == 0:
            logger.warning(f"地图分类特征库为空，返回默认{fallback_map}")
            return fallback_map

        similarities = np.dot(db["features"], query_feat)
        actual_k = min(1, len(db["features"]))
        indices = np.argsort(similarities)[::-1][:actual_k]

        for idx in indices:
            result = db["paths"][idx].split(".")[0]
            max_sim = similarities[idx]
            elapsed = (time.perf_counter() - t0) * 1000
            logger.info(f"地图分类结果: {result}, 最高相似度={max_sim:.4f}, 耗时={elapsed:.1f}ms")
            return result

        logger.warning(f"地图分类无匹配结果，返回默认{fallback_map}")
        return fallback_map


if __name__ == "__main__":
    # 使用示例
    clf = StageClassifier(r"D:\game\RocoKingdom\onnx\dino_backbone.onnx", r"D:\game\RocoKingdom\onnx\features_title_db_1.pkl")
    result = clf.match(r"D:\game\RocoKingdom\assets\pic\test\title_test.png")
    print(result)
