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


def is_dev_environment() -> bool:
    """判断当前是否为开发环境（未使用 PyInstaller 打包）。

    PyInstaller 打包后会注入 sys._MEIPASS（解包资源目录），因此用它作为判据；
    开发环境直接 `python main.py` 运行时不存在该属性。
    """
    return not hasattr(sys, "_MEIPASS")


APP_VERSION = _env("ROCO_APP_VERSION", "1.4.0")
# 默认内存截图（hwnd）；失败时由 tools.capture_window 自动降级为屏幕抓取（grab）
CAPTURE_MODE = _env("ROCO_CAPTURE_MODE", "hwnd")  # grab / hwnd
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
# 图鉴/关键数据更新清单：远程地址为空表示不启用；
# 本地清单（datasets/data_manifest.json）由 tools/pack_update.py 生成，用于 md5 对比
DATA_MANIFEST_URL = _env("ROCO_DATA_MANIFEST_URL",
                         "https://raw.giteeusercontent.com/iozxc/rocokingdom_recognizer/raw/master/datasets/data_manifest.json")

# 徽章试炼定义：草系为正式内容，火系为开发环境专属。
# collection_key 对应 roco_user_data.json 中独立的“已遇见精灵”集合。
TRIALS = [
    {
        "key": "grass",
        "title": "草系徽章试炼",
        "element": "grass",
        "collection_key": "encounteredPets",
        "dev_only": False,
        "map_list": ['map1', 'map2', 'map3'],
        "scene_features": [
            # 记忆中的 [索米亚] 草原：索、米、亚；OCR经常识别错成 素
            ("map1", {"索", "米", "亚", "素"}),
            # 记忆中的 [巨石阵] ：巨、石
            ("map2", {"巨", "石", "阵"}),
            # 记忆中的 [普拉塔草原] ：普、拉、塔
            ("map3", {"普", "拉", "塔"}),
        ],
        "supports_recognition": True,
        "pets_source": "map_pets",
        "maps": [
            {
                "id": "map1",
                "num": 1,
                "name": "记忆中的索米亚草原",
                "description": "绿草如茵的古老草原，微风中飘荡着青草香气，常能遇到草系与萌系小精灵。",
                "themeColor": "#10b981",
                "bgGradient": "from-emerald-500/20 via-teal-500/10 to-green-600/20",
                "badgeBg": "bg-emerald-500/15 text-emerald-700 border-emerald-400",
                "iconName": "Sparkles",
            },
            {
                "id": "map2",
                "num": 2,
                "name": "记忆中的巨石阵",
                "description": "庄严神秘的古代巨石遗迹，凝聚着古老的石系与土系魔力，隐藏着坚毅的守卫者。",
                "themeColor": "#f59e0b",
                "bgGradient": "from-amber-500/20 via-orange-500/10 to-stone-600/20",
                "badgeBg": "bg-amber-500/15 text-amber-800 border-amber-400",
                "iconName": "Shield",
            },
            {
                "id": "map3",
                "num": 3,
                "name": "记忆中的普拉塔草原",
                "description": "王国最广袤的试炼草原，阳光明媚，栖息着各种活泼灵动、身手敏捷的初级精灵。",
                "themeColor": "#3b82f6",
                "bgGradient": "from-sky-500/20 via-indigo-500/10 to-blue-600/20",
                "badgeBg": "bg-sky-500/15 text-sky-800 border-sky-400",
                "iconName": "Compass",
            },
        ],
        "map_pets_json_list": get_resource_path(os.path.join("datasets", "map_pets1.json")),
        "title_feature_path": get_resource_path(os.path.join("onnx", "features_title_db_1.pkl"))
    },
    {
        "key": "fire",
        "title": "火系徽章试炼",
        "element": "fire",
        "collection_key": "encounteredPets2",
        "dev_only": True,
        "map_list": ['map1', 'map2', 'map3'],
        "scene_features": [],
        "supports_recognition": False,
        "pets_source": "pokedex",
        "maps": [
            {
                "id": "map1",
                "num": 1,
                "name": "火系徽章试炼图一",
                "description": "火系徽章试炼第一张地图，全图鉴精灵均可在此自选点亮。",
                "themeColor": "#f97316",
                "bgGradient": "from-orange-500/20 via-red-500/10 to-amber-600/20",
                "badgeBg": "bg-orange-500/15 text-orange-700 border-orange-400",
                "iconName": "Flame",
            },
            {
                "id": "map2",
                "num": 2,
                "name": "火系徽章试炼图二",
                "description": "火系徽章试炼第二张地图，全图鉴精灵均可在此自选点亮。",
                "themeColor": "#ef4444",
                "bgGradient": "from-red-500/20 via-rose-500/10 to-orange-600/20",
                "badgeBg": "bg-red-500/15 text-red-700 border-red-400",
                "iconName": "Flame",
            },
            {
                "id": "map3",
                "num": 3,
                "name": "火系徽章试炼图三",
                "description": "火系徽章试炼第三张地图，全图鉴精灵均可在此自选点亮。",
                "themeColor": "#ea580c",
                "bgGradient": "from-amber-500/20 via-orange-500/10 to-red-600/20",
                "badgeBg": "bg-amber-500/15 text-amber-800 border-amber-400",
                "iconName": "Flame",
            },
        ],
        "map_pets_json_list": get_resource_path(os.path.join("datasets", "map_pets2.json")),
        "title_feature_path": get_resource_path(os.path.join("onnx", "features_title_db_2.pkl"))
    }
]

# 全局信息
# 全图鉴唯一数据源（含 id/seq/name/form_name/elements）
POKEDEX_JSON = get_resource_path(os.path.join('datasets', 'roco_all_pets_info.json'))
DATASETS_PETS = get_resource_path(os.path.join('datasets', 'datasets.db'))
DATA_JSON = get_external_path('roco_user_data.json')
MANIFEST_JSON = get_resource_path('file_manifest.json')
RENAMES_JSON = get_resource_path('pet_renames.json')
OCR_CORRECTIONS_JSON = get_resource_path(os.path.join('datasets', 'ocr_corrections.json'))
DATA_MANIFEST_JSON = get_resource_path(os.path.join("datasets", "data_manifest.json"))

# 全局模型
# 全图鉴图标特征库：识别统一用它，具体试炼的 topk 过滤由服务端按白名单完成
DINO_BACKBONE = get_resource_path(os.path.join('onnx', 'dino_backbone.onnx'))
DINO_FEATURE_FULL = get_resource_path(os.path.join('onnx', 'feature_icon_dino_full.pkl'))
DINO = (DINO_BACKBONE, DINO_FEATURE_FULL)

SCANNER_MODAL = get_resource_path(os.path.join('onnx', 'scanner.onnx'))
DET_MODEL_MODAL = get_resource_path(os.path.join("onnx", "ch_PP-OCRv4_det_infer.onnx"))
CLS_MODEL_MODAL = get_resource_path(os.path.join("onnx", "ch_ppocr_mobile_v2.0_cls_infer.onnx"))
REC_MODEL_MODAL = get_resource_path(os.path.join("onnx", "ch_PP-OCRv4_rec_infer.onnx"))

# 全局设置
DEFAULT_THRESHOLD = 0.9
DEFAULT_TOPK = 6

LOG_LEVEL = getattr(logging, _env("ROCO_LOG_LEVEL", "DEBUG").upper(), logging.DEBUG)
