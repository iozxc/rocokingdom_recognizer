import json
import logging
import os
import sys
import shutil
import tempfile


def _env(name: str, default):
    value = os.environ.get(name)
    return default if value in (None, "") else value


META_CONFIG_URL = _env(
    "ROCO_META_CONFIG_URL",
    "https://raw.giteeusercontent.com/iozxc/rocokingdom_recognizer/raw/master/resources/meta.bin",
)
_remote_meta_cache = None
_remote_meta_reached = False


def _load_remote_meta():
    global _remote_meta_cache, _remote_meta_reached
    if _remote_meta_cache is not None:
        return _remote_meta_cache
    try:
        from core.auth.meta_crypto import load_meta_remote
        _remote_meta_cache, _remote_meta_reached = load_meta_remote(META_CONFIG_URL)
    except Exception:
        _remote_meta_cache = {}
        _remote_meta_reached = False
    return _remote_meta_cache


def meta_reachable() -> bool:
    _load_remote_meta()
    return bool(_remote_meta_reached)


def _meta(key: str):
    v = str(_load_remote_meta().get(key) or "").strip()
    return v or None


def get_resource_path(relative_path):
    if hasattr(sys, '_MEIPASS'):
        return os.path.join(sys._MEIPASS, relative_path)
    return os.path.join(os.path.abspath("."), relative_path)


_WRITABLE_CHECK_CACHE = {}


def _dir_writable(path: str) -> bool:
    """检查目录是否真正可写（尝试创建临时文件），并缓存结果。"""
    key = os.path.normpath(path)
    if key in _WRITABLE_CHECK_CACHE:
        return _WRITABLE_CHECK_CACHE[key]
    try:
        os.makedirs(path, exist_ok=True)
        fd, probe = tempfile.mkstemp(dir=path, prefix=".roco_write_test_")
        try:
            os.close(fd)
        finally:
            try:
                os.remove(probe)
            except OSError:
                pass
        _WRITABLE_CHECK_CACHE[key] = True
        return True
    except Exception:
        _WRITABLE_CHECK_CACHE[key] = False
        return False


def get_external_path(filename):
    """返回需要“运行时写入”的文件路径。

    默认仍写到程序/项目目录（保持原逻辑）；
    仅当该目录没有写权限时，才迁移到 %LOCALAPPDATA% 下的 RocoKingdomRecognizer 目录，
    避免标准账户装到 Program Files 后写数据失败。
    """
    if hasattr(sys, '_MEIPASS'):
        base_path = os.path.dirname(sys.executable)
    else:
        base_path = os.path.dirname(os.path.abspath(__file__))

    preferred = os.path.normpath(os.path.join(base_path, filename))
    parent = os.path.dirname(preferred) or "."
    if _dir_writable(parent):
        return preferred

    # 无写权限：迁移到 %LOCALAPPDATA% 下的 RocoKingdomRecognizer
    local_app_data = os.environ.get("LOCALAPPDATA")
    if not local_app_data:
        local_app_data = os.path.join(os.path.expanduser("~"), "AppData", "Local")
    fallback_base = os.path.join(local_app_data, "RocoKingdomRecognizer")
    try:
        os.makedirs(fallback_base, exist_ok=True)
    except OSError:
        pass
    fallback = os.path.normpath(os.path.join(fallback_base, filename))

    # 首次从旧目录切到 %LOCALAPPDATA% 时，若旧文件存在且新位置还没有，
    # 自动把旧数据复制过去，避免“更新后图鉴/设置好像丢了”。
    if os.path.isfile(preferred) and not os.path.isfile(fallback):
        try:
            shutil.copy2(preferred, fallback)
        except OSError:
            pass
    return fallback


def is_dev_environment() -> bool:
    return not hasattr(sys, "_MEIPASS")


def _read_json_version(path: str) -> str:
    """读一个 JSON 文件里的 version 字段；读不到返回空串。"""
    try:
        with open(path, "r", encoding="utf-8") as f:
            return str(json.load(f).get("version") or "").strip()
    except Exception:
        return ""


def _load_app_version(default: str = "0.0.0") -> str:
    bases = []
    if getattr(sys, "frozen", False):
        bases.append(os.path.dirname(os.path.abspath(sys.executable)))
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        bases.append(meipass)
    bases.append(os.path.dirname(os.path.abspath(__file__)))

    for base in bases:
        ver = _read_json_version(os.path.join(base, "version.json"))
        if ver:
            return ver
    for base in bases:
        ver = _read_json_version(os.path.join(base, "datasets", "data_manifest.json"))
        if ver:
            return ver
    return default


APP_VERSION = _env("ROCO_APP_VERSION", _load_app_version("0.0.0"))
MAX_DELTA_UPDATE_SIZE = int(_env("ROCO_MAX_DELTA_UPDATE_SIZE", str(90 * 1024 * 1024)))
CAPTURE_MODE = _env("ROCO_CAPTURE_MODE", "grab")  # grab / hwnd
GAME_WINDOW_TITLE = _env("ROCO_GAME_WINDOW_TITLE", "洛克王国：世界")
APP_EXE_NAME = _env("ROCO_APP_EXE_NAME", "RocoKingdomRecognizer.exe")
UPDATE_CHECK_URL = _env(
    "ROCO_UPDATE_CHECK_URL",
    "https://gitee.com/iozxc/rocokingdom_recognizer/raw/master/version.json",
)
# 极简更新日志时间线（独立文件，与 version.json 分离，避免清单过大；读取失败不影响更新检测）
CHANGELOG_URL = _env(
    "ROCO_CHANGELOG_URL",
    "https://gitee.com/iozxc/rocokingdom_recognizer/raw/master/changelog.json",
)
FEISHU_WEBHOOK_URL = _env("ROCO_FEISHU_WEBHOOK_URL", _meta("feishu_webhook"))
DATA_MANIFEST_URL = _env("ROCO_DATA_MANIFEST_URL",
                         "https://raw.giteeusercontent.com/iozxc/rocokingdom_recognizer/raw/master/datasets/data_manifest.json")
ROCO_AUTH_SERVER = _env("ROCO_AUTH_SERVER", "https://api.omisheep.cn")
META_AUTH_SERVER = _meta("auth_server")
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
        "title_feature_path": get_resource_path(os.path.join("onnx", "features_title_db_1.pkl"))
        # "title_feature_path": get_resource_path(os.path.join("onnx", "features_title_db_2.pkl"))
    }
]

# 全局信息
# 全图鉴唯一数据源（含 id/seq/name/form_name/elements）
POKEDEX_JSON = get_resource_path(os.path.join('datasets', 'roco_all_pets_info.json'))
DATASETS_PETS = get_resource_path(os.path.join('datasets', 'datasets.db'))
DATASETS_TS = get_resource_path(os.path.join('datasets', 'datasets_ts.db'))
RENAMES_JSON = get_resource_path(os.path.join('datasets', 'pet_renames.json'))
OCR_CORRECTIONS_JSON = get_resource_path(os.path.join('datasets', 'ocr_corrections.json'))
DATA_MANIFEST_JSON = get_resource_path(os.path.join("datasets", "data_manifest.json"))
DATA_JSON = get_external_path('roco_user_data.json')
MANIFEST_JSON = get_resource_path('file_manifest.json')
TRAITS_SKILLS_JSON = get_resource_path('traits_skills.json')

# 全局模型
DINO_BACKBONE = get_resource_path(os.path.join('onnx', 'dino_backbone.onnx'))
DINO_FEATURE_FULL = get_resource_path(os.path.join('onnx', 'feature_icon_dino_full.pkl'))
DINO_FEATURE_DET = get_resource_path(os.path.join('onnx', 'feature_icon_dino_det.pkl'))
DINO_COLOR_DET = get_resource_path(os.path.join('onnx', 'feature_color_icon_det.npy'))
DINO = (DINO_BACKBONE, DINO_FEATURE_FULL)

SCANNER_MODEL = get_resource_path(os.path.join('onnx', 'scanner.onnx'))
SCANNER_INFER_IMGSZ = int(_env("ROCO_SCANNER_INFER_IMGSZ", "1280"))
DET_MODEL = get_resource_path(os.path.join("onnx", "ch_PP-OCRv4_det_infer.onnx"))
CLS_MODEL = get_resource_path(os.path.join("onnx", "ch_ppocr_mobile_v2.0_cls_infer.onnx"))
REC_MODEL = get_resource_path(os.path.join("onnx", "ch_PP-OCRv4_rec_infer.onnx"))

# 全局设置
DEFAULT_THRESHOLD = 0.9
DEFAULT_TOPK = 6

ENABLE_NAME_ANCHOR_FALLBACK = _env("ROCO_ENABLE_ANCHOR_FALLBACK", "1") != "0"

# 推理后端：auto(默认，能用 GPU 就用) / dml / cuda / openvino / cpu
# 记录在 config 里只是为了让设置项集中可见；实际生效逻辑在 core/infra/ort_session.py，
# 它会读同名环境变量，并在 GPU 不可用时自动降级 CPU。
INFER_EP = _env("ROCO_INFER_EP", "auto")
# OCR（RapidOCR）是否走 GPU：auto(默认) / 1 / 0
OCR_GPU = _env("ROCO_OCR_GPU", "auto")

LOG_LEVEL = getattr(logging, _env("ROCO_LOG_LEVEL", "DEBUG").upper(), logging.DEBUG)
