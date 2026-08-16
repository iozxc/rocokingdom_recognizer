import torch
import torch.nn as nn
import torchvision.models as models
import torchvision.transforms as transforms
from PIL import Image
import os


class ImageRecognizer:
    def __init__(self, database_path=None, device="cpu"):
        self.device = device

        # 加载 ResNet50 模型
        model = models.resnet50(weights=models.ResNet50_Weights.IMAGENET1K_V1)
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

    def match(self, img_pil, map_num, threshold=0.7):
        map_key = f"map{map_num}"
        if map_key not in self.map_databases:
            return None, f"Map {map_key} 不存在"

        query_feat = self.get_feature(img_pil)
        db = self.map_databases[map_key]

        with torch.no_grad():
            similarities = torch.mv(db["features"], query_feat)

        score, idx = torch.max(similarities, dim=0)
        score = score.item()

        return {
            "match_path": db["paths"][idx.item()],
            "filename": os.path.basename(db["paths"][idx.item()]),
            "score": round(score, 4)
        }, None
