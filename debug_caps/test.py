import cv2
import os

i = 0
def crop_sections(image_path, output_folder="cropped_results"):
    """
    根据第五张图的紫色框选区域，从输入图片中截取两部分
    """
    # 如果输出文件夹不存在则创建
    global i
    if not os.path.exists(output_folder):
        os.makedirs(output_folder)

    # 读取图片
    img = cv2.imread(image_path)
    if img is None:
        print(f"无法读取图片: {image_path}")
        return

    # 获取图片文件名（不含路径和后缀）用于保存
    base_name = os.path.splitext(os.path.basename(image_path))[0]

    # --- 坐标设置 (基于 3000x1800 分辨率的预估值) ---
    # 格式: [y_start : y_end, x_start : x_end]
    # 您可以根据实际截取效果微调这些数值

    # # 1. 上方标题区域 (紫色小框)
    # # 大约在顶部中央
    title_crop = img[60:140, 930:1650]
    #
    # # 2. 下方角色卡片区域 (紫色大长方形框)
    # # 大约在屏幕中上部，横跨三个角色
    # cards_crop = img[350:600, 600:2000]

    # 3. 下方角色卡片区域 (紫色大长方形框)
    # 大约在屏幕中上部，横跨三个角色
    # item1_crop = img[440:550, 800:880]
    # item2_crop = img[440:550, 1280:1360]
    # item3_crop = img[440:550, 1760:1840]
    #
    # item1_crop = img[550:585, 720:920]
    # item2_crop = img[550:585, 1200:1400]
    # item3_crop = img[550:585, 1680:1880]
    #
    # # --- 保存结果 ---
    # path1 = os.path.join(output_folder, f"{base_name}_item1.png")
    # path2 = os.path.join(output_folder, f"{base_name}_item2.png")
    # path3 = os.path.join(output_folder, f"{base_name}_item3.png")

    path = os.path.join(output_folder, f"{i}_title.png")
    i = i + 1
    #
    # cv2.imwrite(path1, item1_crop)
    # cv2.imwrite(path2, item2_crop)
    # cv2.imwrite(path3, item3_crop)
    cv2.imwrite(path, title_crop)

    print(f"处理完成: {base_name} -> 已保存至 {output_folder}")


# --- 批量处理示例 ---
for img_file in os.listdir('.'):
    # 判断后缀是 .jpg
    if img_file.endswith(".jpg"):
        if os.path.exists(img_file):
            crop_sections(img_file)
        else:
            print(f"文件不存在: {img_file}")
