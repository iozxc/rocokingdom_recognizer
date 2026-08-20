import onnxruntime as ort
import numpy as np
import cv2  # 推荐用 cv2 替代 torchvision 进行图像处理，打包体积更小
import os
import pickle
import time
from logger import logger


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

        # 2. 预处理参数 (必须与 Torchvision 的 Normalize 一致)
        self.mean = np.array([0.485, 0.456, 0.406], dtype=np.float32).reshape((1, 1, 3))
        self.std = np.array([0.229, 0.224, 0.225], dtype=np.float32).reshape((1, 1, 3))

        self.map_databases = {}
        if database_path and os.path.exists(database_path):
            self.load_db(database_path)
        else:
            logger.warning("ImageRecognizer初始化时特征库路径为空或不存在，需后续调用load_db")

    def load_db(self, path):
        """加载经过转换后的 pkl 特征库"""
        logger.debug(f"开始加载特征库: {path}")
        try:
            with open(path, 'rb') as f:
                self.map_databases = pickle.load(f)
            summary = ", ".join(f"{k}={len(v.get('features', []))}" for k, v in self.map_databases.items())
            logger.info(f"--- 成功加载特征库 (NumPy): {path} ---")
            logger.info(f"特征库概览: {summary}")
        except Exception as e:
            logger.error(f"加载特征库失败 {path}: {e}", exc_info=True)
            raise

    def preprocess(self, img):
        """
        手动实现 torchvision.transforms 的逻辑
        """
        # 如果是路径，读取图片；如果是 PIL 对象，转为 numpy
        if isinstance(img, str):
            # 解决 opencv 读取中文路径的问题
            img_data = np.fromfile(img, dtype=np.uint8)
            img_bgr = cv2.imdecode(img_data, cv2.IMREAD_COLOR)
        else:
            # PIL Image 转 numpy (RGB)
            img_bgr = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)

        # 1. 统一转为 RGB 格式
        img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)

        # 2. Resize (224, 224)
        img_resized = cv2.resize(img_rgb, (224, 224), interpolation=cv2.INTER_LINEAR)

        # 3. ToTensor: 转为 float32 并缩放到 [0, 1]
        img_float = img_resized.astype(np.float32) / 255.0

        # 4. Normalize: (img - mean) / std
        img_norm = (img_float - self.mean) / self.std


        # 5. HWC 转 CHW 并增加 Batch 维度: (1, 3, 224, 224)
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

    def match(self, img_pil, map_num, threshold=0.7, top_k=3):
        t0 = time.perf_counter()
        map_key = f"map{map_num}"
        logger.debug(f"ImageRecognizer.match: map={map_key}, threshold={threshold}, top_k={top_k}")

        if map_key not in self.map_databases:
            logger.warning(f"ImageRecognizer.match: 地图 {map_key} 不在特征库中")
            return None, f"Map {map_key} 不存在"

        # 获取查询图片的特征 (1D numpy array)
        query_feat = self.get_feature(img_pil)

        db = self.map_databases[map_key]
        # db["features"] 现在是一个 (N, 2048) 的 numpy 矩阵
        # db["paths"] 是列表

        db_size = len(db["features"])
        logger.debug(f"ImageRecognizer.match: 特征库大小={db_size}")

        # 计算余弦相似度: 矩阵乘向量 (N, 2048) * (2048,) -> (N,)
        similarities = np.dot(db["features"], query_feat)

        # 获取前 top_k 个索引 (按相似度从大到小)
        # np.argsort 返回升序索引，用 [::-1] 反转，然后切片
        actual_k = min(top_k, len(db["features"]))
        indices = np.argsort(similarities)[::-1][:actual_k]

        if len(indices) > 0:
            max_sim = float(similarities[indices[0]])
            logger.debug(f"ImageRecognizer.match: 最高相似度={max_sim:.4f}")

        results = []
        for idx in indices:
            score = float(similarities[idx])  # 转为标准 python float

            if score < threshold:
                continue

            match_path = db["paths"][idx]
            results.append({
                "match_path": match_path,
                "filename": os.path.basename(match_path),
                "name": os.path.basename(match_path).split(".")[0],
                "score": round(score, 4)
            })

        elapsed = (time.perf_counter() - t0) * 1000

        if not results:
            logger.debug(f"ImageRecognizer.match: 无满足阈值的匹配, 耗时={elapsed:.1f}ms")
            return None, "未找到匹配程度足够高的图标"

        top1 = results[0]
        logger.debug(f"ImageRecognizer.match: 匹配成功 top1={top1['name']}({top1['score']:.4f}), "
                    f"候选数={len(results)}, 耗时={elapsed:.1f}ms")
        return results, None
