import onnxruntime as ort
import numpy as np
import cv2
import json
from logger import logger

class MapClassifier:
    def __init__(self, model_path, class_names_path):
        """
        :param model_path: map_classifier.onnx 路径
        :param class_names_path: map_classes.json 路径
        """
        # 1. 加载类别名称
        with open(class_names_path, 'r', encoding='utf-8') as f:
            self.class_names = json.load(f)

        # 2. 初始化 ONNX 会话
        self.session = ort.InferenceSession(model_path, providers=['CPUExecutionProvider'])

        # 3. 预处理参数 (ImageNet 标准)
        # 显式指定为 float32
        self.mean = np.array([0.485, 0.456, 0.406], dtype=np.float32).reshape((1, 1, 3))
        self.std = np.array([0.229, 0.224, 0.225], dtype=np.float32).reshape((1, 1, 3))

        logger.info(f"加载 ONNX 分类模型成功，类别：{self.class_names}")

    def preprocess(self, img):
        """手动实现与 torchvision 一致的预处理"""
        if isinstance(img, str):
            # 支持中文路径读取
            img_data = np.fromfile(img, dtype=np.uint8)
            img = cv2.imdecode(img_data, cv2.IMREAD_COLOR)
        else:
            # PIL 转 OpenCV (假设传入的是 PIL Image)
            img = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)

        # 1. BGR -> RGB
        img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        # 2. Resize
        img = cv2.resize(img, (224, 224))
        # 3. 归一化 [0, 1]
        img = img.astype(np.float32) / 255.0

        # 4. 标准化 (确保 self.mean 和 self.std 也是 float32)
        # 即使这里运算变成了 float64，我们在最后一步会强转回 float32
        img = (img - self.mean) / self.std

        # 5. HWC -> CHW 并增加 Batch 维度
        img = img.transpose(2, 0, 1)[np.newaxis, :]

        # 显式转换为 float32，解决 tensor(double) 报错
        return img.astype(np.float32)

    def softmax(self, x):
        """NumPy 实现 Softmax"""
        e_x = np.exp(x - np.max(x))
        return e_x / e_x.sum(axis=1, keepdims=True)

    def predict(self, img):
        tensor = self.preprocess(img)

        # 执行推理
        inputs = {self.session.get_inputs()[0].name: tensor}
        logits = self.session.run(None, inputs)[0]

        # 计算概率
        probs = self.softmax(logits)[0]

        # 获取最大索引
        pred_idx = int(np.argmax(probs))
        pred_cls = self.class_names[pred_idx]

        # 构造置信度字典
        confidence = {self.class_names[i]: round(float(probs[i]), 4) for i in range(len(self.class_names))}

        return pred_cls, confidence

    def predict_label(self, img):
        pred_cls, _ = self.predict(img)
        return pred_cls


if __name__ == "__main__":
    # 使用示例
    clf = MapClassifier("map_classifier.onnx", "map_classes.json")
    result = clf.predict_label("map3_test.png")
    print(result)