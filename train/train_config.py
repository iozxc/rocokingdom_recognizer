"""YOLO 与分类器训练配置（仅训练脚本使用，与应用运行时配置分离）。

注意：本文件命名为 train_config 而非 config，避免与项目根目录的 config.py
发生模块名冲突（否则脚本里 import config 会解析到本文件自身，导致循环导入）。
"""
import os.path
import sys
from pathlib import Path

import config

# 保证从任意目录直接运行/导入时都能找到根目录的 config.py
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

# --- 数据与模型路径 ---
ASSETS_PATH = config.get_resource_path("assets")
DATA_ICON_ROOT = config.get_resource_path(os.path.join("assets", "pic", "icons_only"))
ASSETS_DB = config.get_resource_path(os.path.join("assets", "assets.db"))
DATA_MAP_ROOT = config.get_resource_path(os.path.join("assets", "pic", "title"))

MAP_MODEL_SAVE_PATH = config.get_resource_path(os.path.join("assets", "features_resnet50_map_classifier.pt"))
MAP_MODEL_SAVE_PKL_PATH = config.get_resource_path(os.path.join("assets", "features_resnet50_map_classifier.pkl"))
# 全图鉴训练数据：train/dataset/image 下所有精灵图片（含多形态）
DATASET_PATH = config.get_resource_path(os.path.join("dataset", "image"))
DATASET_DB = config.get_resource_path(os.path.join("dataset", "datasets.db"))

# 全图鉴特征库：识别不再按试炼训练，统一输出 feature_icon.pt / feature_icon.pkl
FULL_ICON_FEATURE_PT = config.get_resource_path(os.path.join("onnx", "feature_icon.pt"))
FULL_ICON_FEATURE_PKL = config.get_resource_path(os.path.join("onnx", "feature_icon.pkl"))

# 地图标题特征库仍按试炼区分（title_feature_path 保留在 config.TRIALS 中）
TRIALS_META = [
    {
        "map_pets_json_list": trial.get("map_pets_json_list"),
        "title_feature_path": trial.get("title_feature_path"),
    }
    for trial in config.TRIALS
]


# --- 训练超参数 ---
BATCH_SIZE = 4
EPOCHS = 20
LR = 1e-4

# --- 设备 ---
DEVICE = "cpu"

# --- 类别数 ---
NUM_CLASSES = len(config.TRIALS[0]["map_list"])
