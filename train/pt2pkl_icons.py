import torch
import pickle

from train import train_config

def convert_pt_to_pkl_numpy(pt_path: str, pkl_path: str):
    data = torch.load(pt_path, map_location="cpu")
    out_data = {
        "features": data["features"].numpy(),  # tensor → numpy array
        "paths": data["paths"],
    }
    with open(pkl_path, "wb") as f:
        pickle.dump(out_data, f)
    print(f"转换完成(numpy版)！\npt:{pt_path}\npkl:{pkl_path}")


def convert_full():
    """把全图鉴 feature_icon.pt 转成 feature_icon.pkl。"""
    convert_pt_to_pkl_numpy(
        train_config.FULL_ICON_FEATURE_PT,
        train_config.FULL_ICON_FEATURE_PKL,
    )


if __name__ == "__main__":
    #  convert_pt(0)
    convert_full()
