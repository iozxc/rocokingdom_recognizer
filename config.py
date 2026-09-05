import logging
import os
import sys


def _env(name: str, default):
    """读取环境变量；未设置或为空时返回默认值。"""
    value = os.environ.get(name)
    return default if value in (None, "") else value


# --- 远程 meta 配置（“可能会变”的地址从这里读，改仓库一处分发） ---
META_CONFIG_URL = _env(
    "ROCO_META_CONFIG_URL",
    "https://raw.giteeusercontent.com/iozxc/rocokingdom_recognizer/raw/master/resources/meta.bin",
)
_remote_meta_cache = None
_remote_meta_reached = False


def _load_remote_meta():
    """读取远程 resources/meta.bin（解密，进程内只抓一次，失败回退 {}）。"""
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
    """meta.bin（Gitee 仓库）是否可达：用于区分“授权服务器故障”和“用户主动断网”。"""
    _load_remote_meta()
    return bool(_remote_meta_reached)


def _meta(key: str):
    """从远程 meta 取字符串值（去空白）；取不到/为空返回 None。"""
    v = str(_load_remote_meta().get(key) or "").strip()
    return v or None


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


APP_VERSION = _env("ROCO_APP_VERSION", "1.4.6")
# 增量更新包体积上限（字节）：超过则客户端自动回退整包更新；0=不限
MAX_DELTA_UPDATE_SIZE = int(_env("ROCO_MAX_DELTA_UPDATE_SIZE", str(90 * 1024 * 1024)))
CAPTURE_MODE = _env("ROCO_CAPTURE_MODE", "grab")  # grab / hwnd
GAME_WINDOW_TITLE = _env("ROCO_GAME_WINDOW_TITLE", "洛克王国：世界")
# 【地图感知】开放世界玩家定位(零训练视觉方案)：是否启用、参考底图、开关阈值。
# 与徽章试炼无关：这是大世界跑图时按游戏右上角小地图推算玩家世界坐标的功能。
MAP_LOCALIZE_ENABLED = _env("ROCO_MAP_LOCALIZE_ENABLED", "1") == "1"
MAP_LOCALIZE_REFERENCE = _env(
    "ROCO_MAP_LOCALIZE_REFERENCE",
    get_resource_path(os.path.join("static", "mapdata", "level_13_4064_4095_4064_4095.png")),
)
MAP_LOCALIZE_MIN_SCORE = float(_env("ROCO_MAP_LOCALIZE_MIN_SCORE", "0.34"))
MAP_LOCALIZE_DEBUG = _env("ROCO_MAP_LOCALIZE_DEBUG", "0") == "1"
# 首次确认(init/无先验锚点)的更高置信度门槛：得分须达到 INIT_MIN 才转入待确认，
# 避免用“首帧碰巧低分/两处金色区接近”的歧义位置做首次锚定。
MAP_LOCALIZE_INIT_MIN = float(_env("ROCO_MAP_LOCALIZE_INIT_MIN", "0.5"))
# 小地图定位：初始化/场景切换的多帧确认与候选短名单参数
MAP_LOCALIZE_MAX_JUMP = float(_env("ROCO_MAP_LOCALIZE_MAX_JUMP", "180"))
MAP_LOCALIZE_TRACK_CONF_MIN = float(_env("ROCO_MAP_LOCALIZE_TRACK_CONF_MIN", "0.52"))
MAP_LOCALIZE_SIM_CHANGE = float(_env("ROCO_MAP_LOCALIZE_SIM_CHANGE", "0.62"))
MAP_LOCALIZE_INIT_CONFIRM_FRAMES = int(_env("ROCO_MAP_LOCALIZE_INIT_CONFIRM_FRAMES", "2"))
MAP_LOCALIZE_PENDING_LIMIT = int(_env("ROCO_MAP_LOCALIZE_PENDING_LIMIT", "3"))
MAP_LOCALIZE_CANDIDATE_KEEP = int(_env("ROCO_MAP_LOCALIZE_CANDIDATE_KEEP", "4"))
MAP_MONITOR_INTERVAL = float(_env("ROCO_MAP_MONITOR_INTERVAL", "1.5"))
MAP_SAVE_CAPTURE = _env("ROCO_MAP_SAVE_CAPTURE", "1") == "1"
MAP_CAPTURE_DIR = _env("ROCO_MAP_CAPTURE_DIR",
                       get_resource_path(os.path.join("debug", "map_capture")))
MAP_CAPTURE_MAX = int(_env("ROCO_MAP_CAPTURE_MAX", "300"))  # 最多保留最近 N 张
APP_EXE_NAME = _env("ROCO_APP_EXE_NAME", "RocoKingdomRecognizer.exe")
UPDATE_CHECK_URL = _env(
    "ROCO_UPDATE_CHECK_URL",
    "https://gitee.com/iozxc/rocokingdom_recognizer/raw/master/version.json",
)
FEISHU_WEBHOOK_URL = (
        _env("ROCO_FEISHU_WEBHOOK_URL", _meta("feishu_webhook"))
        or "https://open.feishu.cn/open-apis/bot/v2/hook/921e10c3-1b75-4759-9897-4c974bc20aab"
)
# 图鉴/关键数据更新清单：远程地址为空表示不启用；
# 本地清单（datasets/data_manifest.json）由 tools/pack_update.py 生成，用于 md5 对比
DATA_MANIFEST_URL = _env("ROCO_DATA_MANIFEST_URL",
                         "https://raw.giteeusercontent.com/iozxc/rocokingdom_recognizer/raw/master/datasets/data_manifest.json")
# 授权服务器：优先本地 config（环境变量/内置默认）；meta 里的地址作为“主地址连不上”的备用。
ROCO_AUTH_SERVER = _env("ROCO_AUTH_SERVER", "https://api.omisheep.cn")
# 远程 meta 下发的备用授权服务器（client_server 在主地址连接失败时回退到它）。
META_AUTH_SERVER = _meta("auth_server")

# 徽章试炼定义：草系为正式内容，火系为开发环境专属。
# 徽章试炼是游戏内的 roguelike 小游戏：3 个关卡（本配置称 map1/map2/map3，即图1-3），
# 每关顶部有关卡标题，关卡识别 = 标题 OCR + 特征字 / 标题图像分类（非开放世界定位）。
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

TRIALS_META = {
    "element": {
        "light": {"cn": "光", "color": "#FFE870"},
        "ice": {"cn": "冰", "color": "#86E1FF"},
        "ground": {"cn": "地", "color": "#C29461"},
        "illusion": {"cn": "幻", "color": "#C88FFF"},
        "shadow": {"cn": "幽", "color": "#6B4E99"},
        "dark": {"cn": "恶", "color": "#5C5266"},
        "normal": {"cn": "普通", "color": "#C9C0A8"},
        "mechanical": {"cn": "机械", "color": "#94A3B8"},
        "fighting": {"cn": "武", "color": "#D65745"},
        "poison": {"cn": "毒", "color": "#A855C7"},
        "water": {"cn": "水", "color": "#47A8E8"},
        "fire": {"cn": "火", "color": "#F26430"},
        "electric": {"cn": "电", "color": "#F7D338"},
        "flying": {"cn": "翼", "color": "#94B8F0"},
        "grass": {"cn": "草", "color": "#62BC58"},
        "fairy": {"cn": "萌", "color": "#F898C8"},
        "bug": {"cn": "虫", "color": "#92BC2C"},
        "dragon": {"cn": "龙", "color": "#7050D8"}
    }
}

# 全局信息
# 全图鉴唯一数据源（含 id/seq/name/form_name/elements）
POKEDEX_JSON = get_resource_path(os.path.join('datasets', 'roco_all_pets_info.json'))
DATASETS_PETS = get_resource_path(os.path.join('datasets', 'datasets.db'))
DATASETS_TS = get_resource_path(os.path.join('datasets', 'datasets_ts.db'))
RENAMES_JSON = get_resource_path(os.path.join('datasets', 'pet_renames.json'))
OCR_CORRECTIONS_JSON = get_resource_path(os.path.join('datasets', 'ocr_corrections.json'))
DATA_MANIFEST_JSON = get_resource_path(os.path.join("datasets", "data_manifest.json"))
DATA_JSON = get_external_path('roco_user_data.json')
MAP_DATA_JSON = get_external_path('roco_user_mapdata.json')
MANIFEST_JSON = get_resource_path('file_manifest.json')
TRAITS_SKILLS_JSON = get_resource_path('traits_skills.json')

# 全局模型
# 全图鉴图标特征库：识别统一用它，具体试炼的 topk 过滤由服务端按白名单完成
DINO_BACKBONE = get_resource_path(os.path.join('onnx', 'dino_backbone.onnx'))
DINO_FEATURE_FULL = get_resource_path(os.path.join('onnx', 'feature_icon_dino_full.pkl'))
DINO = (DINO_BACKBONE, DINO_FEATURE_FULL)

SCANNER_MODEL = get_resource_path(os.path.join('onnx', 'scanner.onnx'))
# scanner.onnx 是动态输入 shape；跟随识别等实时路径按此尺寸推理。
# 默认 1280：比 1920 快约 2 倍，且对标题×1/精灵×3/名字×3 仍稳定检出（见 test/bench_yolo_size.py）。
# 若某机型检出偏弱，可临时调回 1600/1920。
SCANNER_INFER_IMGSZ = int(_env("ROCO_SCANNER_INFER_IMGSZ", "1280"))
DET_MODEL = get_resource_path(os.path.join("onnx", "ch_PP-OCRv4_det_infer.onnx"))
CLS_MODEL = get_resource_path(os.path.join("onnx", "ch_ppocr_mobile_v2.0_cls_infer.onnx"))
REC_MODEL = get_resource_path(os.path.join("onnx", "ch_PP-OCRv4_rec_infer.onnx"))

# 全局设置
DEFAULT_THRESHOLD = 0.9
DEFAULT_TOPK = 6

LOG_LEVEL = getattr(logging, _env("ROCO_LOG_LEVEL", "INFO").upper(), logging.INFO)
