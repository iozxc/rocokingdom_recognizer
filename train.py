import os
import torch
from core.recognizer import ImageRecognizer
import config


def run_train():
    # 初始化识别器 (无需加载旧库)
    recognizer = ImageRecognizer(device=config.DEVICE)
    db_to_save = {}

    if not os.path.exists('data'): os.makedirs('data')

    for map_name in config.MAP_LIST:
        folder_path = os.path.join(config.ICONS_DIR, map_name)
        if not os.path.exists(folder_path): continue

        print(f"正在处理 {map_name}...")
        feats, paths = [], []

        for f in os.listdir(folder_path):
            if f.endswith('.png'):
                p = os.path.join(folder_path, f)
                feat = recognizer.get_feature(p)
                feats.append(feat.cpu())  # 转到 CPU 存储
                paths.append(p)

        if feats:
            db_to_save[map_name] = {"features": torch.stack(feats), "paths": paths}

    torch.save(db_to_save, config.DATABASE_PATH)
    print(f"训练完成！特征库保存至: {config.DATABASE_PATH}")


if __name__ == "__main__":
    run_train()