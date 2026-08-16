import io
import json
import os
import sys
from flask import Flask, request, jsonify, send_from_directory, url_for
from PIL import Image
from core.processor import segment_icons
from core.recognizer import ImageRecognizer
from flask_cors import CORS
from webview import create_window, start
from threading import Thread

import config
# --- 1. 路径处理核心逻辑 ---
def get_resource_path(relative_path):
    """获取资源绝对路径（用于 icons, static, features_db.pt）"""
    if hasattr(sys, '_MEIPASS'):
        return os.path.join(sys._MEIPASS, relative_path)
    return os.path.join(os.path.abspath("."), relative_path)

config.DATABASE_PATH = get_resource_path('features_db.pt')
config.ICONS_DIR = get_resource_path('icons')

app = Flask(__name__,
            static_folder=get_resource_path('static'),
            template_folder=get_resource_path('static'))
CORS(app)  # 开启跨域访问

# 全局初始化识别器
try:
    print(f"正在加载数据库: {config.DATABASE_PATH}")
    recognizer = ImageRecognizer(database_path=config.DATABASE_PATH, device=config.DEVICE)
    print("数据库加载成功！")
except Exception as e:
    print(f"数据库加载失败: {e}")
    recognizer = None

# --- 3. 预测接口 ---
@app.route('/predict', methods=['POST'])
def predict():
    if 'image' not in request.files:
        return jsonify({"error": "No image"}), 400

    map_num = int(request.form.get('map_num', 1))
    threshold = float(request.form.get('threshold', config.DEFAULT_THRESHOLD))

    try:
        file = request.files['image']
        img = Image.open(io.BytesIO(file.read())).convert('RGB')
        result, err = recognizer.match(img, map_num, threshold)

        if result:
            # 在预测结果中也加入图片查看 URL
            map_name = f"map{map_num}"
            result['view_url'] = url_for('get_icon_file',
                                         map_name=map_name,
                                         filename=result['filename'],
                                         _external=True)
            return jsonify({"status": "success", "data": result})
        return jsonify({"status": "fail", "reason": err}), 404

    except Exception as e:
        return jsonify({"error": str(e)}), 500


# --- 1. 获取具体图片文件的接口 ---
# 访问示例: http://127.0.0.1:5000/icons/map1/0
@app.route('/icons/<map_name>/<filename>')
def get_icon_file(map_name, filename):
    """直接返回图片二进制流"""
    # 构造文件夹路径：icons/map1
    directory = os.path.join(config.ICONS_DIR, map_name)
    # 安全地发送文件
    return send_from_directory(directory, filename)


# --- 2. 获取所有图标列表（带图片URL） ---
@app.route('/icons', methods=['GET'])
def list_icons():
    """返回所有图片的名字及其对应的访问 URL"""
    try:
        icons_structure = {}

        for map_name in config.MAP_LIST:
            folder_path = os.path.join(config.ICONS_DIR, map_name)

            if os.path.exists(folder_path):
                files = [f for f in os.listdir(folder_path) if f.endswith('.png')]

                # 生成每张图片的完整访问链接
                file_links = []
                for f in sorted(files):
                    file_links.append({
                        "name": f,
                        "url": url_for('get_icon_file', map_name=map_name, filename=f, _external=True)
                    })

                icons_structure[map_name] = {
                    "count": len(files),
                    "items": file_links
                }
            else:
                icons_structure[map_name] = {"count": 0, "items": []}

        return jsonify({"status": "success", "data": icons_structure})

    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/init_batch', methods=['POST'])
def predict_batch():
    """
    批量识别接口：上传一张大图，识别其中所有图标
    """
    if 'image' not in request.files:
        return jsonify({"error": "No image uploaded"}), 400

    file = request.files['image']
    map_num = int(request.form.get('map_num', 1))
    threshold = float(request.form.get('threshold', config.DEFAULT_THRESHOLD))
    # 可选：前端可以传想要提取的总数，默认全部提取
    total_count = int(request.form.get('total_count', 999))

    try:
        # 1. 分割图片
        image_bytes = file.read()
        pil_icons = segment_icons(image_bytes, total_count)

        if not pil_icons:
            return jsonify({"status": "fail", "reason": "No icons detected in image"}), 404

        # 2. 逐一对比识别
        batch_results = []
        for i, icon_img in enumerate(pil_icons):
            # 直接调用 recognizer 的 match 方法
            result, err = recognizer.match(icon_img, map_num, threshold)

            res_item = {"index": i}
            if result:
                # 匹配成功，添加详细信息
                res_item.update({
                    "status": "matched",
                    "filename": result['filename'],
                    "score": result['score'],
                    "view_url": url_for('get_icon_file',
                                        map_name=f"map{map_num}",
                                        filename=result['filename'],
                                        _external=True)
                })
            else:
                # 匹配失败（可能数据库里没这张图）
                res_item.update({"status": "unmatched", "reason": err})

            batch_results.append(res_item)

        return jsonify({
            "status": "success",
            "total_detected": len(pil_icons),
            "results": batch_results
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


def get_external_path(filename):
    """获取 .exe 同级目录下的文件路径"""
    if hasattr(sys, '_MEIPASS'):
        # 打包后：sys.executable 是 .exe 的完整路径
        # os.path.dirname(sys.executable) 就是 .exe 所在的文件夹
        base_path = os.path.dirname(sys.executable)
    else:
        # 开发环境：当前 py 文件所在的文件夹
        base_path = os.path.dirname(os.path.abspath(__file__))

    return os.path.normpath(os.path.join(base_path, filename))

# 定义全局变量指向 exe 旁边的 json
DATA_FILE = get_external_path('roco_user_data.json')

# 读取本地存储数据
@app.route('/api/storage', methods=['GET'])
def get_storage():
    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE, 'r', encoding='utf-8') as f:
                return jsonify(json.load(f))
        except Exception as e:
            return jsonify({"error": str(e)}), 500
    # 默认空数据
    return jsonify({
        "encounteredPets": {},
        "thresholds": {},
        "appSettings": {}
    })

# 保存数据到本地磁盘
@app.route('/api/storage', methods=['POST'])
def save_storage():
    try:
        data = request.json
        with open(DATA_FILE, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return jsonify({"status": "success", "message": "Saved to local disk"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
@app.route('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')


@app.route('/<path:path>')
def serve_file(path):
    # 优先检查 static 目录下是否存在该文件
    full_path = os.path.join(app.static_folder, path)
    if os.path.exists(full_path) and os.path.isfile(full_path):
        return send_from_directory(app.static_folder, path)
    # 否则返回 index.html (支持 SPA 路由)
    return send_from_directory(app.static_folder, 'index.html')


def start_server():
    # 必须关闭 reloader (use_reloader=False)，否则在线程中启动会报错
    app.run(host='127.0.0.1', port=5000, threaded=True, debug=False, use_reloader=False)


def start_webview():
    # 获取绝对路径的 webview_data
    def start_logic():
        # 启动 Flask 服务器线程
        t = Thread(target=start_server)
        t.daemon = True
        t.start()

    window = create_window(
        '洛克王国草系徽章试炼',
        'http://127.0.0.1:5000',  # 直接传入 Flask app 对象
        width=1370,
        height=950,
        min_size=(1370, 950)
    )

    start(start_logic) # 开发阶段开启调试，打包前可设为 False

if __name__ == '__main__':
    start_webview()