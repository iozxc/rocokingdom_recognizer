import json
import os
import sys
from pathlib import Path

# 保证脚本从任意目录运行都能找到项目根目录与训练配置
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import torch
import config
import torch.nn as nn
import torchvision.models as models
import torchvision.transforms as transforms
from PIL import Image

from config import get_resource_path
from train import train_config

class ImageRecognizer:
    def __init__(self, database_path=None, device="cpu"):
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

        self.map_databases = {}
        if database_path and os.path.exists(database_path):
            self.load_db(database_path)

    def load_db(self, path):
        self.map_databases = torch.load(path, map_location='cpu')
        for m in self.map_databases:
            self.map_databases[m]['features'] = self.map_databases[m]['features'].to(self.device)
        print(f"--- 成功加载特征库: {path} ---")

    def get_feature(self, img):
        """支持传入路径或 PIL Image 对象"""
        if isinstance(img, str):
            img = Image.open(img).convert('RGB')

        img_tensor = self.transform(img).unsqueeze(0).to(self.device)
        with torch.no_grad():
            feature = self.feature_extractor(img_tensor).flatten()
            feature = feature / feature.norm(p=2)
        return feature

    def match(self, img_pil, map_num, threshold=0.7, top_k=3):
        map_key = f"map{map_num}"
        if map_key not in self.map_databases:
            return None, f"Map {map_key} 不存在"

        query_feat = self.get_feature(img_pil)
        db = self.map_databases[map_key]

        with torch.no_grad():
            # 计算余弦相似度（由于特征已归一化，矩阵乘法即相似度）
            similarities = torch.mv(db["features"], query_feat)

        # 获取前 top_k 个结果
        # 注意：如果数据库图片数量少于 top_k，取实际数量
        actual_k = min(top_k, len(db["features"]))
        scores, indices = torch.topk(similarities, k=actual_k)

        results = []
        for score, idx in zip(scores, indices):
            s = score.item()
            # 过滤掉低于阈值的结果
            if s < threshold:
                continue

            idx_val = idx.item()
            results.append({
                "match_path": db["paths"][idx_val],
                "filename": os.path.basename(db["paths"][idx_val]),
                "name": os.path.basename(db["paths"][idx_val]).split(".")[0],
                "score": round(s, 4)
            })

        if not results:
            return None, "未找到匹配程度足够高的图标"

        return results, None


def run_train(trials_num):
    # 初始化识别器 (无需加载旧库)
    recognizer = ImageRecognizer(device=train_config.DEVICE)
    db_to_save = {}

    # 按关联 JSON 读取：{"map1": {"258_乌达_极夜.png": {"id": 258, "name": "乌达"}, ...}}
    with open(train_config.TRIALS_META[0]["map_pets_json_list"], "r", encoding="utf-8") as f:
        map_pets = json.load(f)

    for map_name in config.TRIALS[0]["map_list"]:
        entries = map_pets.get(map_name, {})
        if not entries:
            print(f"跳过 {map_name}（map_pets1.json 中无条目）")
            continue

        print(f"正在处理 {map_name}（{len(entries)} 个条目）...")
        feats, paths = [], []

        for fname in sorted(entries):
            p = os.path.join(train_config.DATASET_PATH, fname)
            if not os.path.exists(p):
                print(f"    警告：图片不存在，跳过 {fname}")
                continue
            feat = recognizer.get_feature(p)
            feats.append(feat.cpu())
            # 保存数据集文件名（含 .png），与 map_pets1.json / datasets.db 一致
            paths.append(fname)

        if feats:
            db_to_save[map_name] = {"features": torch.stack(feats), "paths": paths}
            print(f"{map_name} 完成：{len(feats)} 张")

    torch.save(db_to_save, train_config.TRIALS_META[trials_num]["icon_feature_path"])
    print(f"训练完成！特征库保存至: {train_config.TRIALS_META[trials_num]["icon_feature_path"]}")


if __name__ == "__main__":
    run_train(0) # 训练草系徽章
