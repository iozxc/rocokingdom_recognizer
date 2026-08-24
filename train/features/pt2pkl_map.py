import torch
import pickle
import numpy as np

from train import train_config


def convert_pt_to_pkl_numpy(pt_path, pkl_path):
    # 1. 加载旧的 torch 格式数据库
    old_db = torch.load(pt_path, map_location='cpu')
    new_db = {}

    features_numpy = old_db['features'].numpy()
    paths = old_db['paths']

    new_db = {
        "features": features_numpy,
        "paths": paths
    }
    print(f"已转换 {features_numpy.shape}")

    # 2. 保存为 pickle 格式
    with open(pkl_path, 'wb') as f:
        pickle.dump(new_db, f)
    print(f"✅ 转换完成！新数据库存放在: {pkl_path}")


def convert(trials_num):
    convert_pt_to_pkl_numpy(train_config.TRIALS_META[trials_num]["title_feature_path"],
                            f"{train_config.TRIALS_META[trials_num]["title_feature_path"]}.pkl")


if __name__ == "__main__":
    # 执行转换
    convert(0)
