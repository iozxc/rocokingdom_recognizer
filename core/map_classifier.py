import onnxruntime as ort
import numpy as np
import cv2
import os
import pickle
from logger import logger


class MapClassifier:
    def __init__(self, onnx_model_path, database_path=None):
        """
        :param model_path: map_classifier.onnx 路径
        :param class_names_path: map_classes.json 路径
        """
        # 1. 加载 ONNX 模型
        if not os.path.exists(onnx_model_path):
            raise FileNotFoundError(f"ONNX 模型文件缺失：{onnx_model_path}")

        # 优化选项：仅使用 CPU 运行
        self.session = ort.InferenceSession(onnx_model_path, providers=['CPUExecutionProvider'])

        # 2. 预处理参数 (必须与 Torchvision 的 Normalize 一致)
        self.mean = np.array([0.485, 0.456, 0.406], dtype=np.float32).reshape((1, 1, 3))
        self.std = np.array([0.229, 0.224, 0.225], dtype=np.float32).reshape((1, 1, 3))

        self.databases = {}
        self.load_db(database_path)

    def load_db(self, path):
        """加载经过转换后的 pkl 特征库"""
        with open(path, 'rb') as f:
            self.databases = pickle.load(f)
        logger.info(f"--- 成功加载特征库 (NumPy): {path} ---")

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
        return feature

    def match(self, img_pil):
        query_feat = self.get_feature(img_pil)
        db = self.databases
        similarities = np.dot(db["features"], query_feat)
        actual_k = min(1, len(db["features"]))
        indices = np.argsort(similarities)[::-1][:actual_k]

        for idx in indices:
            return db["paths"][idx].split(".")[0]
        return "map1"


if __name__ == "__main__":
    # 使用示例
    clf = MapClassifier("resnet50.onnx", "features_title_db.pkl")
    result = clf.match("4.png")
    print(result)