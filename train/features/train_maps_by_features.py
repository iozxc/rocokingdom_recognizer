import os
import sys
from pathlib import Path

# 保证脚本从任意目录运行都能找到项目根目录与训练配置
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import torch
import torch.nn as nn
import torchvision.models as models
import torchvision.transforms as transforms
from PIL import Image

from config import get_resource_path
from train import train_config

class ImageRecognizer:
    def __init__(self, device="cpu"):
        self.device = device

        # 加载 ResNet50 模型
        resnet_weight_path = get_resource_path(os.path.join("assets", "resnet50-0676ba61.pth"))
        if not os.path.exists(resnet_weight_path):
            raise FileNotFoundError(f"ResNet权重文件缺失：{resnet_weight_path}")
        model = models.resnet50(weights=None)
        ckpt = torch.load(resnet_weight_path, map_location=device)
        model.load_state_dict(ckpt)
        self.feature_extractor = nn.Sequential(*list(model.children())[:-1]).to(self.device).eval()

        self.transform = transforms.Compose([
            transforms.Resize((224, 224)),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ])

    def get_feature(self, img):
        """支持传入路径或 PIL Image 对象"""
        if isinstance(img, str):
            img = Image.open(img).convert('RGB')

        img_tensor = self.transform(img).unsqueeze(0).to(self.device)
        with torch.no_grad():
            feature = self.feature_extractor(img_tensor).flatten()
            feature = feature / feature.norm(p=2)
        return feature


def run_train(trials_num):
    # 初始化识别器 (无需加载旧库)
    recognizer = ImageRecognizer(device=train_config.DEVICE)
    db_to_save = {}


    feats, paths = [], []

    for f in os.listdir(train_config.DATA_MAP_ROOT):
        if f.endswith('.png'):
            p = os.path.join(train_config.DATA_MAP_ROOT, f)
            feat = recognizer.get_feature(p)
            feats.append(feat.cpu())
            paths.append(os.path.basename(f))

    db_to_save = {"features": torch.stack(feats), "paths": paths}


    torch.save(db_to_save, train_config.TRIALS_META[trials_num]["title_feature_path"])
    print(f"训练完成！特征库保存至: {train_config.TRIALS_META[trials_num]["title_feature_path"]}")


if __name__ == "__main__":
    run_train(0)
