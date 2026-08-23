import torch
import torch.nn as nn
import torchvision.models as models
import os
import sys
from pathlib import Path

# 保证脚本从任意目录运行都能找到项目根目录
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import warnings
from config import get_resource_path

# 屏蔽无意义的警告信息
warnings.filterwarnings('ignore', category=FutureWarning)
warnings.filterwarnings('ignore', category=UserWarning)


def export_to_onnx():
    device = "cpu"

    # 1. 加载模型
    resnet_weight_path = get_resource_path(os.path.join("assets", "resnet50-0676ba61.pth"))
    if not os.path.exists(resnet_weight_path):
        print(f"❌ 找不到权重文件: {resnet_weight_path}")
        return

    model = models.resnet50(weights=None)
    ckpt = torch.load(resnet_weight_path, map_location=device)
    model.load_state_dict(ckpt)

    # 提取特征层（去掉最后的分类层）
    feature_extractor = nn.Sequential(*list(model.children())[:-1])
    feature_extractor.eval()

    # 2. 准备虚拟输入
    dummy_input = torch.randn(1, 3, 224, 224)

    # 3. 导出设置
    onnx_path = get_resource_path(os.path.join("assets", "resnet50.onnx"))

    print("开始导出（正在处理，请稍候）...")

    try:
        # 直接使用 Opset 18，跳过所有版本转换逻辑，彻底避免 RuntimeError
        torch.onnx.export(
            feature_extractor,
            dummy_input,
            onnx_path,
            export_params=True,
            opset_version=18,  # 关键点：直接用最新版本
            do_constant_folding=True,
            input_names=['input'],
            output_names=['output'],
            dynamic_axes={'input': {0: 'batch_size'}, 'output': {0: 'batch_size'}}
        )

        if os.path.exists(onnx_path):
            print(f"\n✨ [成功] 模型已导出至: {onnx_path}")
            print(f"📏 文件大小: {os.path.getsize(onnx_path) / 1024 / 1024:.2f} MB")

            # --- 立即进行简单的加载验证 ---
            import onnxruntime as ort
            try:
                ort.InferenceSession(onnx_path, providers=['CPUExecutionProvider'])
                print("✅ [验证] 模型在 ONNX Runtime 中加载正常！")
            except Exception as e:
                print(f"❌ [验证] 模型加载失败: {e}")

    except Exception as e:
        print(f"\n❌ [失败] 导出过程中出现异常: {e}")


if __name__ == "__main__":
    export_to_onnx()
