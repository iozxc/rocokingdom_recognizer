import os
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader
from torchvision import models, transforms
from PIL import Image
import config


class MapDataset(Dataset):
    def __init__(self, root_dir, class_names, transform=None):
        self.root_dir = root_dir
        self.class_names = class_names
        self.transform = transform
        self.samples = []

        for label_idx, cls_name in enumerate(class_names):
            folder = os.path.join(root_dir, cls_name)
            if not os.path.exists(folder):
                continue
            for fname in os.listdir(folder):
                if fname.lower().endswith(".png"):
                    img_path = os.path.join(folder, fname)
                    self.samples.append((img_path, label_idx))

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        img_path, label = self.samples[idx]
        image = Image.open(img_path).convert("RGB")
        if self.transform:
            image = self.transform(image)
        return image, label


def run_train():
    train_transform = transforms.Compose([
        transforms.Resize((224, 224)),
        transforms.RandomHorizontalFlip(p=0.3),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
    ])

    dataset = MapDataset(config.DATA_ROOT, config.MAP_LIST, transform=train_transform)
    dataloader = DataLoader(dataset, batch_size=config.BATCH_SIZE, shuffle=True)
    print(f"数据集总样本数：{len(dataset)}")

    # ResNet50，替换最后一层为3分类
    model = models.resnet50(weights=models.ResNet50_Weights.IMAGENET1K_V1)
    in_features = model.fc.in_features
    model.fc = nn.Linear(in_features, config.NUM_CLASSES)
    model = model.to(config.DEVICE)

    criterion = nn.CrossEntropyLoss()
    optimizer = optim.Adam(model.parameters(), lr=config.LR)

    model.train()
    for epoch in range(config.EPOCHS):
        total_loss = 0.0
        for imgs, labels in dataloader:
            imgs = imgs.to(config.DEVICE)
            labels = labels.to(config.DEVICE)

            optimizer.zero_grad()
            outputs = model(imgs)
            loss = criterion(outputs, labels)
            loss.backward()
            optimizer.step()

            total_loss += loss.item()

        avg_loss = total_loss / len(dataloader)
        print(f"Epoch [{epoch+1}/{config.EPOCHS}], loss: {avg_loss:.4f}")

    # 保存模型权重
    torch.save({
        "model_state_dict": model.state_dict(),
        "class_names": config.MAP_LIST
    }, config.MAP_MODEL_SAVE_PATH)
    print(f"训练完成，模型保存至 {config.MAP_MODEL_SAVE_PATH}")


if __name__ == "__main__":
    run_train()