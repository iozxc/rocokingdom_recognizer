import os
import sys
import json
from pathlib import Path

# 保证脚本从任意目录运行都能找到项目根目录与训练配置
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import torch
import torch.nn as nn
from torchvision import models

from train import train_config as config


def export_classifier():
    # 1. 构建模型结构 (必须与训练时完全一致)
    model = models.resnet50()
    in_features = model.fc.in_features
    model.fc = nn.Linear(in_features, config.NUM_CLASSES)

    # 2. 加载权重
    model_path = "features_resnet50_map_classifier.pt"
    checkpoint = torch.load(model_path, map_location="cpu")
    model.load_state_dict(checkpoint["model_state_dict"])
    model.eval()

    # 3. 提取并保存类别名称 (ONNX 不存这个，我们存 JSON)
    class_names = checkpoint["class_names"]
    with open("map_classes.json", "w", encoding="utf-8") as f:
        json.dump(class_names, f, ensure_ascii=False)

    # 4. 导出 ONNX
    dummy_input = torch.randn(1, 3, 224, 224)
    onnx_path = "map_classifier.onnx"

    torch.onnx.export(
        model,
        dummy_input,
        onnx_path,
        export_params=True,
        opset_version=18,  # 与之前的特征提取器保持一致
        do_constant_folding=True,
        input_names=['input'],
        output_names=['output'],
        dynamic_axes={'input': {0: 'batch_size'}, 'output': {0: 'batch_size'}}
    )

    print(f"✅ 分类器导出成功: {onnx_path}")
    print(f"✅ 类别映射已存至: map_classes.json")


if __name__ == "__main__":
    export_classifier()
