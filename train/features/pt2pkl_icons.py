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

if __name__ == "__main__":
    convert_pt_to_pkl_numpy(train_config.DATABASE_ICON_PATH, train_config.DATABASE_ICON_PKL_PATH)
