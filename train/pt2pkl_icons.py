import os

import torch
import pickle

from config import get_resource_path
from train import train_config

def convert_pt_to_pkl_numpy(pt_path: str, pkl_path: str):
    data = torch.load(pt_path, map_location="cpu")
    out_data = {}
    for key, val in data.items():
        out_data[key] = {
            "features": val["features"].numpy(),   # tensor → numpy array
            "paths": val["paths"]
        }
    with open(pkl_path, "wb") as f:
        pickle.dump(out_data, f)
    print(f"转换完成(numpy版)！\npt:{pt_path}\npkl:{pkl_path}")


def convert_pt(trials_num: int):
    convert_pt_to_pkl_numpy(train_config.TRIALS_META[trials_num]["icon_feature_path"]["pt"],
                            train_config.TRIALS_META[trials_num]["icon_feature_path"]["pkl"])


if __name__ == "__main__":
    convert_pt(0)
