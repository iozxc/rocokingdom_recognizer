import logging
import os
import sys


def _env(name: str, default):
    """读取环境变量；未设置或为空时返回默认值。"""
    value = os.environ.get(name)
    return default if value in (None, "") else value


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

# 用户配置（可用环境变量覆盖）
CAPTURE_MODE = _env("ROCO_CAPTURE_MODE", "grab")  # grab / hwnd

# --- 网络与外部服务（可用环境变量覆盖） ---
GAME_WINDOW_TITLE = _env("ROCO_GAME_WINDOW_TITLE", "洛克王国：世界")
APP_VERSION = _env("ROCO_APP_VERSION", "1.3.2")
APP_EXE_NAME = _env("ROCO_APP_EXE_NAME", "RocoKingdomRecognizer.exe")
UPDATE_CHECK_URL = _env(
    "ROCO_UPDATE_CHECK_URL",
    "https://gitee.com/iozxc/rocokingdom_recognizer/raw/master/version.json",
)
FEISHU_WEBHOOK_URL = _env(
    "ROCO_FEISHU_WEBHOOK_URL",
    "https://open.feishu.cn/open-apis/bot/v2/hook/921e10c3-1b75-4759-9897-4c974bc20aab",
)

# 基础路径
ICONS_DIR = get_resource_path('icons')
OCR_DIR = get_resource_path('ocr_models')
ONNX_DIR = get_resource_path('onnx')

ASSETS_FILE = get_resource_path('assets.db')
PETS_FILE = get_resource_path('roco_all_pets.json')
DATA_FILE = get_external_path('roco_user_data.json')

# MAP_CLASSIFIER = get_resource_path(os.path.join('onnx', 'map_classifier.onnx'))
RESNET50 = get_resource_path(os.path.join('onnx', 'resnet50.onnx'))

MAP_CLASSES = get_resource_path(os.path.join('onnx', 'map_classes.json'))

FEATURES_DB = get_resource_path(os.path.join('onnx', 'features_db.pkl'))
FEATURES2_DB = get_resource_path(os.path.join('onnx', 'features_title_db.pkl'))

SCANNER = get_resource_path(os.path.join('onnx', 'scanner.onnx'))

DEFAULT_THRESHOLD = 0.9
DEFAULT_TOPK = 6

# 地图列表
MAP_LIST = ['map1', 'map2', 'map3']

LOG_LEVEL = getattr(logging, _env("ROCO_LOG_LEVEL", "DEBUG").upper(), logging.DEBUG)
