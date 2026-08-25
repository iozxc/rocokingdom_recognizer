"""OCR 误识纠错：把 OCR 常见识别错的文字强行纠正为正确名。

数据源：项目根目录 ocr_corrections.json，两层结构：
    word_corrections: 整词替换（最安全，整串完全匹配才替换）
    char_corrections: 单字替换（全局形近字，误伤风险高，默认留空）

用法：
    from core.ocr_corrections import correct_ocr_text
    final = correct_ocr_text(ocr_recognized_text)

模块级缓存，数据文件变化后可调用 invalidate() 刷新。
"""

import json
from functools import lru_cache

import config
from core.logger import logger


# 数据文件路径（config.OCR_CORRECTIONS_JSON，缺省回退到项目根）
_CORRECTIONS_PATH = getattr(config, "OCR_CORRECTIONS_JSON", "ocr_corrections.json")


def _load() -> dict:
    """读取纠错表；失败返回空结构。"""
    try:
        with open(_CORRECTIONS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return {"word_corrections": {}, "char_corrections": {}}
        return {
            "word_corrections": data.get("word_corrections") or {},
            "char_corrections": data.get("char_corrections") or {},
        }
    except FileNotFoundError:
        logger.warning(f"OCR 纠错表不存在: {_CORRECTIONS_PATH}，返回空")
        return {"word_corrections": {}, "char_corrections": {}}
    except Exception as e:
        logger.error(f"读取 OCR 纠错表失败 {_CORRECTIONS_PATH}: {e}", exc_info=True)
        return {"word_corrections": {}, "char_corrections": {}}


@lru_cache(maxsize=1)
def _cached():
    return _load()


def invalidate():
    """清空纠错表缓存（文件被人工修改/追加后调用）。"""
    _cached.cache_clear()


def correct_ocr_text(text):
    """对 OCR 识别文本应用纠错。先整词替换，再单字替换。"""
    if not text:
        return text
    data = _cached()
    result = str(text)

    # 1) 整词替换（整串匹配 / 子串替换，避免被其他字符隔断）
    for wrong, right in (data.get("word_corrections") or {}).items():
        if wrong and wrong in result:
            result = result.replace(wrong, right)

    # 2) 单字替换（需要清理掉已替换词，防止二次误伤；仅当表里有内容才跑）
    char_map = data.get("char_corrections") or {}
    if char_map:
        # 先保护整词替换产物：整体替换后一般不会被单字误伤，此处直接用 str.translate
        # 不算最优但简单；若担心误伤，可保持 char_corrections 留空。
        trans = str.maketrans(char_map)
        result = result.translate(trans)

    if result != text:
        logger.debug(f"OCR 纠错: {text!r} -> {result!r}")
    return result


def add_correction(wrong, right, kind="word"):
    """追加一条纠错到 ocr_corrections.json（供人工修正回流）。

    kind: 'word' 整词 / 'char' 单字。
    """
    if not wrong or not right or wrong == right:
        return False
    try:
        with open(_CORRECTIONS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        data = {"word_corrections": {}, "char_corrections": {}}
    data.setdefault("word_corrections", {})
    data.setdefault("char_corrections", {})
    key = "word_corrections" if kind == "word" else "char_corrections"
    data[key][wrong] = right
    with open(_CORRECTIONS_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    invalidate()
    logger.info(f"已追加 OCR 纠错({key}): {wrong!r} -> {right!r}")
    return True
