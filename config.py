import logging
import os
import sys


# --- 路径处理核心逻辑 ---
def get_resource_path(relative_path):
    """获取资源绝对路径（用于 icons, static, features_db.pt）"""
    if hasattr(sys, '_MEIPASS'):
        return os.path.join(sys._MEIPASS, relative_path)
    return os.path.join(os.path.abspath("."), relative_path)


def get_external_path(filename):
    """获取 .exe 同级目录下的文件路径"""
    if hasattr(sys, '_MEIPASS'):
        # 打包后：sys.executable 是 .exe 的完整路径
        # os.path.dirname(sys.executable) 就是 .exe 所在的文件夹
        base_path = os.path.dirname(sys.executable)
    else:
        # 开发环境：当前 py 文件所在的文件夹
        base_path = os.path.dirname(os.path.abspath(__file__))

    return os.path.normpath(os.path.join(base_path, filename))

# 用户配置
CAPTURE_MODE = "grab" # hwnd

# 基础路径
ICONS_DIR = get_resource_path('icons')
OCR_DIR = get_resource_path('ocr_models')
ONNX_DIR = get_resource_path('onnx')

DATABASE_PATH = get_resource_path('features_db.pt')
DATABASE2_PATH = get_resource_path('features_title_db.pt')
ASSETS_FILE = get_resource_path('assets.db')
DATA_FILE = get_external_path('roco_user_data.json')
PETS_FILE = get_external_path('roco_all_pets.json')

MAP_CLASSIFIER = get_resource_path(os.path.join('onnx', 'map_classifier.onnx'))
MAP_CLASSES = get_resource_path(os.path.join('onnx', 'map_classes.json'))
RESNET50 = get_resource_path(os.path.join('onnx', 'resnet50.onnx'))
FEATURES_DB = get_resource_path(os.path.join('onnx', 'features_db.pkl'))
FEATURES2_DB = get_resource_path(os.path.join('onnx', 'features_title_db.pkl'))
SCANNER = get_resource_path(os.path.join('onnx', 'scanner.onnx'))

DEFAULT_THRESHOLD = 0.9
DEFAULT_TOPK = 6
# DEVICE = torch.device("cuda:0" if torch.cuda.is_available() else "cpu")
DEVICE = "cpu"

# 地图列表
MAP_LIST = ['map1', 'map2', 'map3']

DATA_ROOT = r"D:\game\RocoKingdom\assets\pic\title"
NUM_CLASSES = len(MAP_LIST)
MAP_MODEL_SAVE_PATH = get_resource_path('features_resnet50_map_classifier.pt')
BATCH_SIZE = 4
EPOCHS = 20
LR = 1e-4

LOG_LEVEL = logging.DEBUG