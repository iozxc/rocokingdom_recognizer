import logging
import os
import torch
import torch.nn as nn
from torchvision import models, transforms
from PIL import Image
import config


class MapClassifier:
    def __init__(self, model_path, device="cpu"):
        self.device = device
        self.transform = transforms.Compose([
            transforms.Resize((224, 224)),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
        ])

        # 构建模型
        self.model = models.resnet50()
        in_features = self.model.fc.in_features
        self.model.fc = nn.Linear(in_features, config.NUM_CLASSES)

        checkpoint = torch.load(model_path, map_location=device)
        self.model.load_state_dict(checkpoint["model_state_dict"])
        self.class_names = checkpoint["class_names"]

        self.model.to(self.device)
        self.model.eval()
        logging.info(f"加载分类模型成功，类别：{self.class_names}")

    def predict(self, img):
        """
        img: PIL Image对象 或者图片路径
        返回：(类别名称, 置信度dict)
        """
        if isinstance(img, str):
            img = Image.open(img).convert("RGB")
        tensor = self.transform(img).unsqueeze(0).to(self.device)

        with torch.no_grad():
            logits = self.model(tensor)
            probs = torch.softmax(logits, dim=1)[0]

        pred_idx = int(torch.argmax(probs).item())
        pred_cls = self.class_names[pred_idx]
        confidence = {self.class_names[i]: round(float(probs[i]),4) for i in range(len(self.class_names))}
        return pred_cls, confidence

    def predict_label(self, img):
        """直接返回置信度最高的标签名，例如 'map3'"""
        pred_cls, _ = self.predict(img)
        return pred_cls


recognizer = MapClassifier(config.MAP_MODEL_SAVE_PATH, device=config.DEVICE)


if __name__ == "__main__":
    # 测试推理示例
    clf = MapClassifier(r"D:\game\RocoKingdom\features_resnet50_map_classifier.pt", device=config.DEVICE)
    pred_name = clf.predict_label(r"D:\game\RocoKingdom\assets\pic\title\map3_test.png")
    print(f"预测结果：{pred_name}")
