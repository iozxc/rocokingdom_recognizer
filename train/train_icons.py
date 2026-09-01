import os
import sys
from pathlib import Path

# 保证脚本从任意目录运行都能找到项目根目录与训练配置
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))
if str(Path(__file__).resolve().parent) not in sys.path:
    sys.path.insert(0, str(Path(__file__).resolve().parent))

import torch
import torch.nn as nn
import torchvision.models as models
import torchvision.transforms as transforms
from PIL import Image

from config import get_resource_path
import train_config
from core.infra.pet_path import sort_key

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


def run_train_full():
    """训练全图鉴特征库：遍历 train/dataset/image 下全部图片（含多形态），

    输出 onnx/feature_icon.pt（结构为 {"features": ..., "paths": [...]}）。
    识别时统一用这个全图鉴库，再由服务端按试炼白名单过滤 topk。
    """
    recognizer = ImageRecognizer(device=train_config.DEVICE)
    image_dir = train_config.DATASET_PATH
    # 按 (id, 形态序号, 名字) 排序后再训练，保证特征库 paths 顺序与前端展示排序一致。
    files = sorted(
        (f for f in os.listdir(image_dir)
         if f.lower().endswith((".png", ".jpg", ".jpeg"))),
        key=sort_key,
    )
    if not files:
        print(f"未在 {image_dir} 找到任何图片，请检查训练数据路径")
        return

    print(f"全图鉴训练开始：共 {len(files)} 张图片")
    feats, paths = [], []
    for fname in files:
        p = os.path.join(image_dir, fname)
        feat = recognizer.get_feature(p)
        feats.append(feat.cpu())
        paths.append(fname)

    db_to_save = {"features": torch.stack(feats), "paths": paths}
    os.makedirs(os.path.dirname(train_config.FULL_ICON_FEATURE_PT), exist_ok=True)
    torch.save(db_to_save, train_config.FULL_ICON_FEATURE_PT)
    print(f"全图鉴特征库训练完成！保存至: {train_config.FULL_ICON_FEATURE_PT}")


if __name__ == "__main__":
    # run_train(0)
    run_train_full()
