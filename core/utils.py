import os
import config
from difflib import SequenceMatcher

def scan_icon_names():
    """
    扫描 icons 目录下所有子文件夹的文件名
    返回: {"map1": ["小拉塔", "迪莫"], "map2": []}
    """
    names_dict = {}

    for map_name in config.MAP_LIST:
        # 这里的 config.ICONS_DIR 已经是绝对路径了
        map_folder = os.path.join(config.ICONS_DIR, map_name)

        names_dict[map_name] = []

        if os.path.exists(map_folder):
            for filename in os.listdir(map_folder):
                # 仅处理图片
                if filename.lower().endswith(('.png', '.jpg', '.jpeg')):
                    name_without_ext = os.path.splitext(filename)[0]
                    names_dict[map_name].append(name_without_ext)
        else:
            print(f"警告: 路径确实不存在: {map_folder}")

    return names_dict


def get_icon_full_path(map_name, icon_name_without_ext):
    """
    通过 map 名和图片名（不含后缀）反查文件的绝对路径
    """
    map_folder = os.path.join(config.ICONS_DIR, map_name)

    # 尝试常见的图片后缀
    for ext in ['.png', '.jpg', '.jpeg']:
        full_path = os.path.join(map_folder, icon_name_without_ext + ext)
        if os.path.exists(full_path):
            return os.path.normpath(full_path)

    return None


def get_best_match(user_name, map_key, names_dict):
    """
    在指定的 map 列表里寻找与 user_name 最相似的字符串
    :param user_name: 用户提供的名字（或 OCR 识别到的）
    :param map_key: 字典的键，如 "map1"
    :param names_dict: 你获取到的那个全量字典
    :return: (最匹配的字符串, 匹配度得分)
    """
    # 1. 安全检查：如果 key 不存在或列表为空
    if map_key not in names_dict or not names_dict[map_key]:
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
    return best_name, round(max_score, 4)


def get_top_k_matches(user_name, map_key, names_dict, k=3):
    """
    在指定的 map 列表里寻找与 user_name 最相似的前 K 个字符串
    :param user_name: 用户提供的名字（或 OCR 识别到的）
    :param map_key: 字典的键，如 "map1"
    :param names_dict: 图标名称字典
    :param k: 需要返回的前几个结果
    :return: 包含 {"name": 名字, "score": 分数} 的列表，按分数从高到低排序
    """
    # 1. 安全检查
    if map_key not in names_dict or not names_dict[map_key]:
        return []

    candidates = names_dict[map_key]
    scored_results = []

    # 2. 计算所有候选词的相似度
    for candidate in candidates:
        # 建议这里也做一下简单的 strip() 处理
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

    return top_k

if __name__ == '__main__':
    # 假设这是你扫描出来的 dict
    names = {
        "map1": ["小拉塔", "迪莫", "皮卡丘", "皮卡丘1", "皮卡丘2", "皮卡丘3", "皮卡丘4", "皮卡丘5", "皮卡皮卡"],
        "map2": ["火花", "喵喵"],
        "map3": ["水蓝蓝"]
    }

    # 模拟用户输入了 "小拉" (OCR 可能没识别全)
    target_key = "map1"
    input_text = "皮卡"

    match_name, score = get_best_match(input_text, target_key, names)

    print(f"输入: {input_text}")
    print(f"在 {target_key} 中找到最匹配的是: {match_name}")
    print(f"匹配度(置信度): {score}")
    # 输出示例: 匹配度: 0.8 (因为 "小拉" 是 "小拉塔" 的子串)

    results  = get_top_k_matches(input_text, target_key, names, 6)
    print(results)
