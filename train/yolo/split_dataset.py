import os
import shutil
import random
from pathlib import Path

# =====================配置区=====================
# 基于脚本目录定位数据集，避免从其他目录运行时找不到
dataset_root = str(Path(__file__).resolve().parent / "dataset")
images_dir = os.path.join(dataset_root, "images")
labels_dir = os.path.join(dataset_root, "labels")

train_dir = os.path.join(dataset_root, "train")
val_dir = os.path.join(dataset_root, "val")

train_img = os.path.join(train_dir, "images")
train_lab = os.path.join(train_dir, "labels")
val_img = os.path.join(val_dir, "images")
val_lab = os.path.join(val_dir, "labels")

val_split = 0.2   # 20%做验证集
seed = 42
# ================================================

# 创建文件夹
for d in [train_img, train_lab, val_img, val_lab]:
    os.makedirs(d, exist_ok=True)

# 获取所有txt标签文件
label_files = [f for f in os.listdir(labels_dir) if f.endswith(".txt")]
random.seed(seed)
random.shuffle(label_files)

val_size = int(len(label_files) * val_split)
val_set = label_files[:val_size]
train_set = label_files[val_size:]

def copy_files(label_list, is_val: bool):
    for lab_f in label_list:
        # 标签复制
        src_lab = os.path.join(labels_dir, lab_f)
        if is_val:
            dst_lab = os.path.join(val_lab, lab_f)
        else:
            dst_lab = os.path.join(train_lab, lab_f)
        shutil.copy(src_lab, dst_lab)

        # 图片：txt后缀换成png
        img_name = os.path.splitext(lab_f)[0] + ".png"
        src_img = os.path.join(images_dir, img_name)
        if not os.path.exists(src_img):
            # 如果是jpg就换后缀
            img_name_jpg = os.path.splitext(lab_f)[0] + ".jpg"
            src_img = os.path.join(images_dir, img_name_jpg)
        if is_val:
            dst_img = os.path.join(val_img, os.path.basename(src_img))
        else:
            dst_img = os.path.join(train_img, os.path.basename(src_img))
        shutil.copy(src_img, dst_img)


copy_files(train_set, is_val=False)
copy_files(val_set, is_val=True)

print(f"总样本：{len(label_files)}")
print(f"训练集：{len(train_set)}")
print(f"验证集：{len(val_set)}")
print("数据集划分完成")
