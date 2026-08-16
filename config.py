import torch

# 基础路径
ICONS_DIR = 'icons'
DATABASE_PATH = 'features_db.pt'

# 默认参数
DEFAULT_THRESHOLD = 0.7
DEVICE = torch.device("cuda:0" if torch.cuda.is_available() else "cpu")

# 地图列表
MAP_LIST = ['map1', 'map2', 'map3']