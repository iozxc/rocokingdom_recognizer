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
    # --- predict.py ---

    @app.route('/predict', methods=['POST'])
    def predict():
        if 'image' not in request.files:
            return jsonify({"error": "No image"}), 400

        map_num = int(request.form.get('map_num', 1))
        threshold = float(request.form.get('threshold', config.DEFAULT_THRESHOLD))
        # 允许前端通过参数控制返回数量，默认 3
        top_k = int(request.form.get('top_k', 3))

        try:
            file = request.files['image']
            img = Image.open(io.BytesIO(file.read())).convert('RGB')

            # 这里的 results 现在是一个列表
            results, err = recognizer.match(img, map_num, threshold, top_k=top_k)

            if results:
                map_name = f"map{map_num}"
                # 遍历列表，为每个匹配项添加 view_url
                for res in results:
                    res['view_url'] = url_for('get_icon_file',
                                              map_name=map_name,
                                              filename=res['filename'],
                                              _external=True)

                return jsonify({
                    "status": "success",
                    "count": len(results),
                    "data": results  # 此时 data 是一个数组
                })

            return jsonify({"status": "fail", "reason": err}), 404

        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route('/init_batch', methods=['POST'])
    def predict_batch():
        """
        批量识别接口：上传一张大图，识别其中所有图标，每个图标返回 Top-K 个候选结果
        """
        if 'image' not in request.files:
            return jsonify({"error": "No image uploaded"}), 400

        file = request.files['image']
        map_num = int(request.form.get('map_num', 1))
        threshold = float(request.form.get('threshold', config.DEFAULT_THRESHOLD))
        # 新增：获取 top_k 参数，默认 3
        top_k = int(request.form.get('top_k', 3))
        total_count = int(request.form.get('total_count', 999))

        try:
            # 1. 分割图片
            image_bytes = file.read()
            pil_icons = segment_icons(image_bytes, total_count)

            if not pil_icons:
                return jsonify({"status": "fail", "reason": "No icons detected in image"}), 404

            # 2. 逐一对比识别
            batch_results = []
            map_name = f"map{map_num}"

            for i, icon_img in enumerate(pil_icons):
                # 调用 recognizer 的 match 方法（假设你已经按照上一条建议修改了 recognizer.py）
                # 它现在返回的是一个 list
                results, err = recognizer.match(icon_img, map_num, threshold, top_k=top_k)

                res_item = {"index": i}
                if results:
                    # 匹配成功，处理 list 中的每一个候选结果
                    for res in results:
                        res['view_url'] = url_for('get_icon_file',
                                                  map_name=map_name,
                                                  filename=res['filename'],
                                                  _external=True)

                    res_item.update({
                        "status": "matched",
                        "candidates": results  # 这里包含 Top-K 个结果
                    })
                else:
                    # 匹配失败（所有候选均低于阈值或数据库为空）
                    res_item.update({
                        "status": "unmatched",
                        "reason": err or "No candidates above threshold"
                    })

                batch_results.append(res_item)

            return jsonify({
                "status": "success",
                "total_detected": len(pil_icons),
                "results": batch_results
            })

        except Exception as e:
            import traceback
            traceback.print_exc()  # 打印错误日志方便调试
            return jsonify({"error": str(e)}), 500
