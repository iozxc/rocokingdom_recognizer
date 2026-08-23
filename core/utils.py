import config
from difflib import SequenceMatcher

import os

os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"
import numpy as np
from PIL import Image

from core.logger import logger


def get_icon_full_path(map_name, icon_name_without_ext):
    return os.path.normpath(os.path.join(config.ICONS_DIR, map_name, icon_name_without_ext + '.png'))


def get_best_match(user_name, map_key, names_dict):
    logger.debug(f"get_best_match: user='{user_name}', map={map_key}")

    # 1. 安全检查：如果 key 不存在或列表为空
    if map_key not in names_dict or not names_dict[map_key]:
        logger.warning(f"get_best_match: 地图 {map_key} 不存在或为空")
        return None, 0.0

    candidates = names_dict[map_key]
    best_name = None
    max_score = 0.0

    # 2. 遍历列表，计算每一个候选词的相似度
    for candidate in candidates:
        # SequenceMatcher 计算 0.0 到 1.0 之间的分值
        # ratio() 算法: 2.0 * M / T (M是匹配字符数, T是总字符数)
        score = SequenceMatcher(None, user_name, candidate).ratio()

        if score > max_score:
            max_score = score
            best_name = candidate

    # 3. 返回结果 (例如: "小拉塔", 0.85)
    logger.debug(f"get_best_match: 最佳匹配='{best_name}', 得分={max_score:.4f}")
    return best_name, round(max_score, 4)


def get_top_k_matches(user_name, map_key, names_dict, k=3):
    logger.debug(f"get_top_k_matches: user='{user_name}', map={map_key}, k={k}")

    # 1. 安全检查
    if map_key not in names_dict or not names_dict[map_key]:
        logger.warning(f"get_top_k_matches: 地图 {map_key} 不存在或为空")
        return []

    candidates = names_dict[map_key]
    scored_results = []

    # 2. 计算所有候选词的相似度
    for candidate in candidates:
        score = SequenceMatcher(None, user_name.strip(), candidate.strip()).ratio()

        scored_results.append({
            "name": candidate,
            "score": round(score, 4)
        })

    # 3. 排序：按 score 从大到小排序
    # x['score'] 是排序依据，reverse=True 表示降序
    scored_results.sort(key=lambda x: x['score'], reverse=True)

    # 4. 返回前 K 个结果
    # 如果列表长度不足 K，slice 会自动返回现有的全部
    top_k = scored_results[:k]

    if top_k:
        top1 = top_k[0]
        logger.debug(f"get_top_k_matches: top1='{top1['name']}'({top1['score']:.4f}), "
                    f"返回{len(top_k)}个候选")
    else:
        logger.debug("get_top_k_matches: 无匹配结果")

    return top_k


# 2k
def crop_sections_from_pil(pil_image: Image.Image):
    logger.debug(f"crop_sections_from_pil(固定坐标): 图片尺寸={pil_image.size}")

    arr = np.array(pil_image)

    # 大约在顶部中央
    title_arr = arr[40:145, 930:1650, :]

    # 大约在屏幕中上部，横跨三个角色
    name1_arr = arr[550:585, 720:920, :]
    name2_arr = arr[550:585, 1200:1400, :]
    name3_arr = arr[550:585, 1680:1880, :]

    # 三个精灵
    item1_arr = arr[440:550, 800:880, :]
    item2_arr = arr[440:550, 1280:1360, :]
    item3_arr = arr[440:550, 1760:1840, :]

    title_pil = Image.fromarray(title_arr)

    name1_pil = Image.fromarray(name1_arr)
    name2_pil = Image.fromarray(name2_arr)
    name3_pil = Image.fromarray(name3_arr)

    item1_pil = Image.fromarray(item1_arr)
    item2_pil = Image.fromarray(item2_arr)
    item3_pil = Image.fromarray(item3_arr)

    return title_pil, [name1_pil, name2_pil, name3_pil], [item1_pil, item2_pil, item3_pil]

if __name__ == "__main__":
    img = Image.open("test.jpg")
    title_pil, name_pils, item_pils = crop_sections_from_pil(img)

    # name_pils = [pil, pil, None]  2人对战第三个是None
    for idx, nm_pil in enumerate(name_pils):
        if nm_pil is not None:
            nm_pil.save(f"name_{idx + 1}.jpg")

    for idx, it_pil in enumerate(item_pils):
        if it_pil is not None:
            it_pil.save(f"item_{idx + 1}.jpg")

    if title_pil:
        title_pil.save("title.jpg")
