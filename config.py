import os
import sys

import torch

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
DATABASE_PATH = get_resource_path('features_db.pt')
DATA_FILE = get_external_path('roco_user_data.json')

DEFAULT_THRESHOLD = 0.9
DEFAULT_TOPK = 6
DEVICE = torch.device("cuda:0" if torch.cuda.is_available() else "cpu")

# 地图列表
MAP_LIST = ['map1', 'map2', 'map3']