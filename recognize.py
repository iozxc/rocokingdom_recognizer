# 文件名: recognize.py
import os
import torch
import torch.nn as nn
import torchvision.models as models
import torchvision.transforms as transforms
from PIL import Image


class ImageRecognizer:
    def __init__(self, database_path):
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        print(f"使用设备: {self.device}")

        # 模型和预处理依然需要，用于处理新的查询图片
        model = models.resnet50(weights=models.ResNet50_Weights.IMAGENET1K_V1)
        self.feature_extractor = nn.Sequential(*list(model.children())[:-1]).to(self.device).eval()
        self.transform = transforms.Compose([
            transforms.Resize((224, 224)),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ])

        # 加载预训练的数据库
        self.map_databases = self.load_database(database_path)

    def load_database(self, filepath):
        """从文件加载特征库，并将其中的 Tensor 移到当前设备"""
        if not os.path.exists(filepath):
            raise FileNotFoundError(f"数据库文件 {filepath} 未找到！请先运行 train_and_save.py")

        # 加载到 CPU，然后再手动移到 GPU，更安全
        data = torch.load(filepath, map_location='cpu')

        # 将每个 map 的 features tensor 移动到当前使用的设备 (GPU or CPU)
        for map_name in data:
            data[map_name]['features'] = data[map_name]['features'].to(self.device)

        print(f"✅ 特征数据库 {filepath} 加载成功！")
        return data

    def _get_query_feature(self, img_path):
        """提取待查询图片的特征"""
        # (这个函数和训练时的一样)
        try:
            img = Image.open(img_path).convert('RGB')
            img_tensor = self.transform(img).unsqueeze(0).to(self.device)
            with torch.no_grad():
                feature = self.feature_extractor(img_tensor).flatten()
                feature = feature / feature.norm(p=2)
            return feature
        except Exception as e:
            return None

    def recognize(self, query_img_path, map_index, threshold=0.8):
        """在指定的 map 中进行比对"""
        map_key = f"map{map_index}"

        if map_key not in self.map_databases:
            print(f"错误: 数据库中不存在 {map_key} 的数据。")
            return None

        query_feat = self._get_query_feature(query_img_path)
        if query_feat is None: return None

        db = self.map_databases[map_key]
        db_features = db["features"]

        with torch.no_grad():
            similarities = torch.mv(db_features, query_feat)

        best_score, best_idx = torch.max(similarities, dim=0)
        score, idx = best_score.item(), best_idx.item()

        if score >= threshold:
            return {
                "match_path": db["paths"][idx],
                "score": score,
                "filename": os.path.basename(db["paths"][idx])
            }
        return None

def get_image_match(recognizer, img_path, map_num, threshold=0.7):
    """
    封装后的识别函数
    :param recognizer: 已经初始化好的 ImageRecognizer 实例
    :param img_path: 待识别图片的路径 (字符串)
    :param map_num: 地图编号 (整数 1, 2 或 3)
    :param threshold: 相似度阈值
    :return: 匹配结果字典 或 None
    """
    if not os.path.exists(img_path):
        print(f"错误: 测试图片 {img_path} 不存在！")
        return None

    # 执行识别
    result = recognizer.recognize(img_path, map_num, threshold=threshold)

    if result:
        print(f"\n[识别成功]")
        print(f"目标地图: map{map_num}")
        print(f"最匹配文件: {result['filename']}")
        print(f"置信度: {result['score']:.4f}")
        return result
    else:
        print(f"\n在 map{map_num} 中未找到高相似度图标。")
        return None


# ================= 现在的调用方式 =================
if __name__ == "__main__":
    DATABASE_FILE = 'features_db.pt'

    try:
        # 1. 只需要初始化一次识别器 (加载模型和数据库)
        my_recognizer = ImageRecognizer(database_path=DATABASE_FILE)

        # 2. 调用函数进行识别 (可以在循环里多次调用此函数)
        # 你想抽离的两个参数直接传进去即可
        final_result = get_image_match(
            recognizer=my_recognizer,
            img_path="assets/pic/test_04.png",
            map_num=2,
            threshold=0.7
        )

        # 3. 处理返回的结果
        if final_result:
            print(f"逻辑后续处理：匹配到了 {final_result['filename']}")

    except FileNotFoundError as e:
        print(e)