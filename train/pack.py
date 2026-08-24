import sqlite3
import py7zr
import os

from train import train_config


def build_assets_db(source_dir, db_path):
    # 连接数据库（不存在则创建）
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # 创建表：path 是图片相对路径（如 map1/0.png），data 是二进制内容
    cursor.execute('DROP TABLE IF EXISTS icons')
    cursor.execute('''
                   CREATE TABLE icons
                   (
                       path TEXT PRIMARY KEY,
                       data BLOB
                   )
                   ''')

    count = 0
    # 遍历 icons 目录
    for root, dirs, files in os.walk(source_dir):
        for file in files:
            if file.lower().endswith(('.png', '.jpg', '.jpeg')):
                # 计算相对路径，例如: map1/0.png
                full_path = os.path.join(root, file)
                rel_path = os.path.relpath(full_path, source_dir).replace('\\', '/').split('.')[0]

                with open(full_path, 'rb') as f:
                    img_data = f.read()
                    cursor.execute('INSERT INTO icons VALUES (?, ?)', (rel_path, img_data))
                    count += 1

    conn.commit()
    conn.close()
    print(f"成功打包 {count} 张图片到 {db_path}")


if __name__ == '__main__':
    # 执行打包：将 datasets/image 目录打包进 datasets/datasets.db
    build_assets_db(train_config.DATASET_PATH, train_config.DATASET_DB)
