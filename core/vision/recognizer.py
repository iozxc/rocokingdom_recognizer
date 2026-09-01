import onnxruntime as ort
import numpy as np
import cv2
import os
import pickle
import time
from core.infra.logger import logger
from core.infra.utils import strip_id_prefix
from core.infra.pet_path import split_pet_filename
from PIL import Image


class ImageRecognizer:
    def __init__(self, onnx_model_path, database_path=None):
        """
        使用 ONNX Runtime 初始化识别器
        :param onnx_model_path: feature_extractor.onnx 的路径
        :param database_path: features_db.pkl (NumPy 格式) 的路径
        """
        logger.info(f"初始化ImageRecognizer: 模型={onnx_model_path}, 特征库={database_path}")

        # 1. 加载 ONNX 模型
        if not os.path.exists(onnx_model_path):
            logger.error(f"ONNX模型文件缺失: {onnx_model_path}")
            raise FileNotFoundError(f"ONNX 模型文件缺失：{onnx_model_path}")

        # 仅使用 CPU 运行
        self.session = ort.InferenceSession(onnx_model_path, providers=['CPUExecutionProvider'])
        logger.info("ImageRecognizer ONNX模型加载成功 (CPU)")

        # 3. 从 ONNX 输入推断输入尺寸（resnet=224, dino=518 均自动适配）
        self.input_size = 224
        try:
            in_shape = self.session.get_inputs()[0].shape
            if len(in_shape) == 4 and isinstance(in_shape[2], int) and isinstance(in_shape[3], int):
                self.input_size = int(in_shape[2])
        except Exception:
            pass
        logger.info(f"ImageRecognizer 输入尺寸: {self.input_size}")

        # 2. 预处理参数 (必须与 Torchvision 的 Normalize 一致)
        self.mean = np.array([0.485, 0.456, 0.406], dtype=np.float32).reshape((1, 1, 3))
        self.std = np.array([0.229, 0.224, 0.225], dtype=np.float32).reshape((1, 1, 3))

        self.database = {}
        if database_path and os.path.exists(database_path):
            self.load_db(database_path)
        else:
            logger.warning("ImageRecognizer初始化时特征库路径为空或不存在，需后续调用load_db")

    def load_db(self, path):
        """加载经过转换后的 pkl 特征库"""
        logger.debug(f"开始加载特征库: {path}")
        try:
            with open(path, 'rb') as f:
                self.database = pickle.load(f)
            feat_count = len(self.database.get("features", []))
            logger.info(f"--- 成功加载特征库 (NumPy): {path} ---")
            logger.info(f"特征库概览: features={feat_count}")
        except Exception as e:
            logger.error(f"加载特征库失败 {path}: {e}", exc_info=True)
            raise

    def preprocess(self, img):
        """
        手动实现 torchvision.transforms 的逻辑
        """
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
            arr = np.array(img)
            if arr.dtype == object:
                raise RuntimeError("preprocess: PIL对象无效，np.array得到object数组")
            img_bgr = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
        else:
            raise TypeError(f"preprocess: 不支持的输入类型 {type(img)}, 需要str路径或PIL.Image")

        # 1. 统一转为 RGB 格式
        img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)

        # 2. Resize (根据模型输入尺寸：resnet=224, dino=518)
        sz = self.input_size
        img_resized = cv2.resize(img_rgb, (sz, sz), interpolation=cv2.INTER_LINEAR)

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
        logger.debug(f"ImageRecognizer特征提取: 维度={len(feature)}, 耗时={elapsed:.1f}ms")
        return feature

    def match(self, img_pil, threshold=0.7, top_k=3):
        t0 = time.perf_counter()
        logger.debug(f"ImageRecognizer.match: threshold={threshold}, top_k={top_k}")

        db = self.database
        if not db or "features" not in db or len(db["features"]) == 0:
            logger.warning("ImageRecognizer.match: 特征库为空")
            return None, "特征库为空"

        # 捕获图片处理异常，不再抛出cv2错误到上层
        try:
            query_feat = self.get_feature(img_pil)
        except Exception as e:
            logger.error(f"ImageRecognizer.match 图片预处理失败: {e}", exc_info=True)
            return None, "图片预处理失败"

        db_size = len(db["features"])
        logger.debug(f"ImageRecognizer.match: 特征库大小={db_size}")

        similarities = np.dot(db["features"], query_feat)
        # 放宽候选池：多视角特征库里同一 id/形态会有多条(icon + _shot截图)，
        # 先取足够多的原始候选，去重后再截 top_k。
        pool_k = max(top_k * 4, 24)
        pool_k = min(pool_k, len(db["features"]))
        indices = np.argsort(similarities)[::-1][:pool_k]

        if len(indices) > 0:
            max_sim = float(similarities[indices[0]])
            logger.debug(f"ImageRecognizer.match: 最高相似度={max_sim:.4f}")

        # 收集原始候选
        raw = []
        for idx in indices:
            score = float(similarities[idx])
            if score < threshold:
                continue
            raw.append((score, db["paths"][idx]))

        # 以 (id, seq) 归一化去重：_shot 截图与本体视为同一形态，取最高分。
        # 最终返回的 match_path/filename 用"非 _shot 本体名"，便于 /icons 查库、
        # 前端显示干净；_shot 只用于"确认该形态存在多视角证据"。
        merged = {}   # key=(id, seq) -> {"score", "match_path", "filename", "name", "shot"}
        shot_info = split_pet_filename
        for score, match_path in raw:
            info = shot_info(match_path)
            if info and info.get("id") is not None:
                key = (info["id"], info["seq"])
            else:
                key = (match_path, None)
            is_shot = "_shot" in os.path.basename(match_path)
            if key not in merged:
                merged[key] = {
                    "score": round(score, 4),
                    "match_path": match_path,
                    "filename": os.path.basename(match_path),
                    "name": strip_id_prefix(os.path.basename(match_path)).split(".")[0],
                    "shot": is_shot,
                }
            elif score > merged[key]["score"]:
                merged[key]["score"] = round(score, 4)
                # 若新候选是非 _shot 本体，则替换展示名（更干净）
                if not is_shot:
                    merged[key].update({
                        "match_path": match_path,
                        "filename": os.path.basename(match_path),
                        "name": strip_id_prefix(os.path.basename(match_path)).split(".")[0],
                        "shot": False,
                    })

        # 按分数降序，取 top_k；并把展示名里的 _shot 剔除
        results = []
        for item in sorted(merged.values(), key=lambda x: x["score"], reverse=True)[:top_k]:
            item = dict(item)
            # 保证 filename/name 不带 _shot 后缀（若该 key 全是 _shot，则去掉后缀）
            if item["shot"] and "_shot" in item["filename"]:
                item["filename"] = item["filename"].replace("_shot.png", ".png")
                item["name"] = item["name"].replace("_shot", "")
                item["match_path"] = item["match_path"].replace("_shot", "")
            results.append(item)

        elapsed = (time.perf_counter() - t0) * 1000

        if not results:
            logger.debug(f"ImageRecognizer.match: 无满足阈值的匹配, 耗时={elapsed:.1f}ms")
            return None, "未找到匹配程度足够高的图标"

        top1 = results[0]
        logger.debug(f"ImageRecognizer.match: 匹配成功 top1={top1['name']}({top1['score']:.4f}), "
                    f"候选数={len(results)}, 耗时={elapsed:.1f}ms")
        return results, None
