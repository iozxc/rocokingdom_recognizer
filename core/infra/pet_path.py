"""精灵数据集文件名（<id>_<形态序号>_<名字>.png）的统一解析与格式化。

数据集目录里的图片命名有两种形态：
  单形态： <id>_<名字>.png          例： 002_喵喵.png
  多形态： <id>_<形态序号>_<名字>.png  例： 001_01_迪莫.png、004_02_叶冕魔力猫.png

本模块提供统一的解析、格式化、排序逻辑，供：
  - train/pack.py / train_icons.py（打包与训练）
  - core/api/main.py、core/api/trials.py、core/utils.py（后端）
  - 前端展示（去掉形态序号，但保留 id + 形态序号 排序）
使用，避免各处理解不一致。
"""

import re
from typing import Optional


# 形如 "001_01_迪莫" 或 "001_迪莫"（不强制 .png 后缀）
_PATH_RE = re.compile(r"^(\d{1,4})_(?:(\d{1,3})_)?(.+)$")
# 形如 "001_01_迪莫.png"
_PATH_RE_EXT = re.compile(r"^(\d{1,4})_(?:(\d{1,3})_)?(.+)\.(png|jpg|jpeg|webp|gif|bmp|svg)$")


def split_pet_filename(filename: str) -> Optional[dict]:
    """解析数据集文件名，返回 {id, seq, name, ext}；无法解析返回 None。

    '001_01_迪莫.png'   -> {'id': 1,  'seq': 1,        'name': '迪莫',   'ext': 'png'}
    '002_喵喵.png'      -> {'id': 2,  'seq': None,     'name': '喵喵',   'ext': 'png'}
    '004_叶冕魔力猫'    -> {'id': 4,  'seq': None,     'name': '叶冕魔力猫', 'ext': None}

    注意：名字本身允许包含下划线（如 '鸭吉吉_蓬松'），因此只有紧跟 id 的纯数字
    段才被当作形态序号。
    """
    if not filename:
        return None
    name = str(filename).strip()
    m = _PATH_RE_EXT.match(name)
    ext = None
    if m:
        id_str, seq_str, pet_name, ext = m.groups()
    else:
        m = _PATH_RE.match(name)
        if not m:
            # 完全不含 id 前缀的名字（如 '喵喵.png'）当作纯名字处理
            bare = re.sub(r"\.(png|jpg|jpeg|webp|gif|bmp|svg)$", "", name)
            return {"id": None, "seq": None, "name": bare,
                    "ext": re.search(r"\.(png|jpg|jpeg|webp|gif|bmp|svg)$", name).group(1)
                    if re.search(r"\.(png|jpg|jpeg|webp|gif|bmp|svg)$", name) else None}
        id_str, seq_str, pet_name = m.groups()

    pid = int(id_str)
    seq = int(seq_str) if seq_str else None
    return {"id": pid, "seq": seq, "name": pet_name, "ext": ext}


def format_display_name(filename: str) -> str:
    """处理成用于展示的精灵名：去掉 id 前缀与形态序号，保留名字（含形态后缀）。

    '001_01_迪莫.png'  -> '迪莫'
    '004_02_叶冕魔力猫.png' -> '叶冕魔力猫'
    '002_喵喵.png'     -> '喵喵'
    '乌达_极夜.png'    -> '乌达_极夜'
    """
    info = split_pet_filename(filename)
    if not info:
        return filename
    return info["name"] if info["name"] else filename


def sort_key(filename: str):
    """排序键：优先按 id，再按形态序号（无序号视为 0），最后按名字。

    保证同一 id 的多个形态按序排列（普通/首领顺序由形态序号决定）。
    """
    info = split_pet_filename(filename)
    if not info:
        return (1 << 30, 0, filename)
    pid = info["id"] if info["id"] is not None else (1 << 30)
    seq = info["seq"] if info["seq"] is not None else 0
    return (pid, seq, info["name"] or "")


def sort_key_for_part(part_id, seq, name=""):
    """给定 id/seq/name 构造排序键（供无具体文件名时使用）。"""
    return (int(part_id) if part_id is not None else (1 << 30),
            int(seq) if seq is not None else 0,
            name or "")
