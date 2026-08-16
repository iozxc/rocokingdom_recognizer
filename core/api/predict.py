import io
from flask import request, jsonify, url_for
from PIL import Image

from core.processor import segment_icons
import config
from core.recognizer import ImageRecognizer

# 全局初始化识别器
try:
    print(f"正在加载数据库: {config.DATABASE_PATH}")
    recognizer = ImageRecognizer(database_path=config.DATABASE_PATH, device=config.DEVICE)
    print("数据库加载成功！")
except Exception as e:
    print(f"数据库加载失败: {e}")
    recognizer = None


def init_routes(app):
    # --- 预测接口 ---
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
