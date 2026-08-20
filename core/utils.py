import ctypes
import config
from difflib import SequenceMatcher
import win32gui
import win32ui

import os

os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"
import numpy as np
from PIL import Image

def get_icon_full_path(map_name, icon_name_without_ext):
    """
    通过 map 名和图片名（不含后缀）反查文件的绝对路径
    """
    return os.path.normpath(os.path.join(config.ICONS_DIR, map_name, icon_name_without_ext + '.png'))


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


# 2k
def crop_sections_from_pil(pil_image: Image.Image):
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


def capture_window_by_hwnd(hwnd):
    """
    通过 PrintWindow 直接捕获窗口画面（不经过屏幕截图）。
    窗口被遮挡、部分在屏幕外也能抓到。
    返回 PIL Image，失败返回 None。
    """
    # 获取窗口尺寸（整个窗口，含标题栏，与原 ImageGrab 行为一致）
    left, top, right, bottom = win32gui.GetWindowRect(hwnd)
    width = right - left
    height = bottom - top
    if width <= 0 or height <= 0:
        return None

    hwndDC = win32gui.GetWindowDC(hwnd)
    mfcDC = win32ui.CreateDCFromHandle(hwndDC)
    saveDC = mfcDC.CreateCompatibleDC()

    saveBitMap = win32ui.CreateBitmap()
    saveBitMap.CreateCompatibleBitmap(mfcDC, width, height)
    saveDC.SelectObject(saveBitMap)

    # PW_RENDERFULLCONTENT = 2，可捕获硬件加速/视频/游戏画面
    result = ctypes.windll.user32.PrintWindow(hwnd, saveDC.GetSafeHdc(), 2)

    bmpinfo = saveBitMap.GetInfo()
    bmpstr = saveBitMap.GetBitmapBits(True)

    img = Image.frombuffer(
        'RGB',
        (bmpinfo['bmWidth'], bmpinfo['bmHeight']),
        bmpstr, 'raw', 'BGRX', 0, 1
    )

    # 释放 GDI 资源，防止泄漏
    win32gui.DeleteObject(saveBitMap.GetHandle())
    saveDC.DeleteDC()
    mfcDC.DeleteDC()
    win32gui.ReleaseDC(hwnd, hwndDC)

    return img if result else None


# if __name__ == '__main__':
#     # 假设这是你扫描出来的 dict
#     names = {
#         "map1": ["小拉塔", "迪莫", "皮卡丘", "皮卡丘1", "皮卡丘2", "皮卡丘3", "皮卡丘4", "皮卡丘5", "皮卡皮卡"],
#         "map2": ["火花", "喵喵"],
#         "map3": ["水蓝蓝"]
#     }
#
#     # 模拟用户输入了 "小拉" (OCR 可能没识别全)
#     target_key = "map1"
#     input_text = "皮卡"
#
#     match_name, score = get_best_match(input_text, target_key, names)
#
#     print(f"输入: {input_text}")
#     print(f"在 {target_key} 中找到最匹配的是: {match_name}")
#     print(f"匹配度(置信度): {score}")
#     # 输出示例: 匹配度: 0.8 (因为 "小拉" 是 "小拉塔" 的子串)
#
#     results = get_top_k_matches(input_text, target_key, names, 6)
#     print(results)

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
