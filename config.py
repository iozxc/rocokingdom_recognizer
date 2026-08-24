import logging
import os
import sys


def _env(name: str, default):
    """读取环境变量；未设置或为空时返回默认值。"""
    value = os.environ.get(name)
    return default if value in (None, "") else value


APP_VERSION = _env("ROCO_APP_VERSION", "1.3.3")

CAPTURE_MODE = _env("ROCO_CAPTURE_MODE", "grab")  # grab / hwnd
GAME_WINDOW_TITLE = _env("ROCO_GAME_WINDOW_TITLE", "洛克王国：世界")
APP_EXE_NAME = _env("ROCO_APP_EXE_NAME", "RocoKingdomRecognizer.exe")
UPDATE_CHECK_URL = _env(
    "ROCO_UPDATE_CHECK_URL",
    "https://gitee.com/iozxc/rocokingdom_recognizer/raw/master/version.json",
)
FEISHU_WEBHOOK_URL = _env(
    "ROCO_FEISHU_WEBHOOK_URL",
    "https://open.feishu.cn/open-apis/bot/v2/hook/921e10c3-1b75-4759-9897-4c974bc20aab",
)


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


# 基础路径
ICONS_DIR = get_resource_path('icons')
OCR_DIR = get_resource_path('ocr_models')
ONNX_DIR = get_resource_path('onnx')

ALL_PETS_JSON = get_resource_path(os.path.join('datasets', 'roco_all_pets.json'))
DATASETS_PETS = get_resource_path(os.path.join('datasets', 'datasets.db'))
MAP_PETS_JSON1 = get_resource_path(os.path.join('datasets', 'map_pets1.json'))
DATA_JSON = get_external_path('roco_user_data.json')
MANIFEST_JSON = get_resource_path('file_manifest.json')
RENAMES_JSON = get_resource_path('pet_renames.json')

RESNET50 = get_resource_path(os.path.join('onnx', 'resnet50.onnx'))
FEATURES_ICON = get_resource_path(os.path.join('onnx', 'features_icon_db.pkl'))
FEATURES_TITLE = get_resource_path(os.path.join('onnx', 'features_title_db.pkl'))
SCANNER_MODAL = get_resource_path(os.path.join('onnx', 'scanner.onnx'))
DET_MODEL_MODAL = get_resource_path(os.path.join("ocr_models", "ch_PP-OCRv4_det_infer.onnx"))
CLS_MODEL_MODAL = get_resource_path(os.path.join("ocr_models", "ch_ppocr_mobile_v2.0_cls_infer.onnx"))
REC_MODEL_MODAL = get_resource_path(os.path.join("ocr_models", "ch_PP-OCRv4_rec_infer.onnx"))

DEFAULT_THRESHOLD = 0.9
DEFAULT_TOPK = 6

# 地图列表
MAP_LIST = ['map1', 'map2', 'map3']

LOG_LEVEL = getattr(logging, _env("ROCO_LOG_LEVEL", "DEBUG").upper(), logging.DEBUG)
