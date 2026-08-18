import os
import tempfile

from flask import request, jsonify, url_for
from PIL import Image

from core.ocr import OCREngine
from core.processor import segment_icons
import config
from core.recognizer import ImageRecognizer
from core.utils import scan_icon_names, get_top_k_matches, get_icon_full_path, logger

# 全局初始化识别器
try:
    logger.info(f"正在加载数据库: {config.DATABASE_PATH}")
    recognizer = ImageRecognizer(database_path=config.DATABASE_PATH, device=config.DEVICE)
    logger.info("数据库加载成功！")
except Exception as e:
    logger.error(f"数据库加载失败: {e}")
    recognizer = None

try:
    names_dict = scan_icon_names()
except Exception as e:
    logger.error(e)

try:
    ocr = OCREngine()
except Exception as e:
    logger.error(e)

def f(image):
    ocr_names = ocr.recognize_bottom_text(image)
    return ocr_names


def ocr_top_k_match(image, map_num, top_k=6):
    # 1. OCR 提取文字
    name = ocr.recognize_single_bottom_text(image)

    # 如果没有识别到文字，直接返回空列表
    if not name:
        return []

    # 2. 通过你已有的 get_top_k_matches 获取初步匹配列表
    map_key = f"map{map_num}"
    raw_result_list = get_top_k_matches(name, map_key, names_dict, top_k)

    # 3. 转换格式并补充 match_path
    final_ocr_results = []
    for item in raw_result_list:
        # 获取图片的绝对路径
        full_path = get_icon_full_path(map_key, item['name'])

        if full_path:
            # 这里的格式必须与 ImageRecognizer 返回的格式完全一致
            final_ocr_results.append({
                "match_path": full_path,
                "filename": os.path.basename(full_path),  # 自动带上 .png 后缀
                "score": item['score']
            })

    return final_ocr_results


def init_routes(app):
    @app.route('/predict', methods=['POST'])
    def predict():
        if 'image' not in request.files:
            return jsonify({"error": "No image"}), 400

        # 1. 获取参数
        file = request.files.get('image')
        map_num = request.form.get('map_num', 1)
        threshold = float(request.form.get('threshold', config.DEFAULT_THRESHOLD))
        top_k = int(request.form.get('top_k', config.DEFAULT_TOPK))

        if not file:
            return jsonify({"error": "No image uploaded"}), 400

        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix='.png') as temp_file:
                temp_path = temp_file.name
                file.save(temp_path)

            img = Image.open(temp_path).convert('RGB')

            feat_results, err = recognizer.match(img, map_num, threshold, top_k=top_k)

            if err:
                return jsonify({"error": err}), 500

            ocr_results = ocr_top_k_match(temp_path, map_num, top_k=top_k)

            combined_results = feat_results + ocr_results

            # 去重：如果同一个文件既被特征匹配到，也被 OCR 匹配到，取分数高的那个
            unique_results = {}
            for res in combined_results:
                path = res['match_path']
                if path not in unique_results or res['score'] > unique_results[path]['score']:
                    unique_results[path] = res

            # 转回列表
            final_list = list(unique_results.values())

            # 排序：按 score 从高到低
            final_list.sort(key=lambda x: x['score'], reverse=True)

            # 截取 top_k 个
            final_list = final_list[:top_k]

            # 6. 清理临时文件
            if os.path.exists(temp_path):
                os.remove(temp_path)

            if final_list:
                map_name = f"map{map_num}"
                # 遍历列表，为每个匹配项添加 view_url
                for res in final_list:
                    res['view_url'] = url_for('get_icon_file',
                                              map_name=map_name,
                                              filename=res['filename'],
                                              _external=True)

                return jsonify({
                    "status": "success",
                    "count": len(final_list),
                    "data": final_list  # 此时 data 是一个数组
                })

            return jsonify({"status": "fail", "reason": err}), 404

        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route('/init_batch', methods=['POST'])
    def predict_batch():
        if 'image' not in request.files:
            return jsonify({"error": "No image uploaded"}), 400

        file = request.files['image']
        map_num = int(request.form.get('map_num', 1))
        threshold = float(request.form.get('threshold', config.DEFAULT_THRESHOLD))
        top_k = int(request.form.get('top_k', 6))
        total_count = int(request.form.get('total_count', 999))

        temp_path = None
        try:
            # 1. 保存临时文件
            with tempfile.NamedTemporaryFile(delete=False, suffix='.png') as tmp:
                temp_path = tmp.name
                file.save(temp_path)

            # 2. OCR 识别（拿到底部名字列表）
            ocr_names = ocr.recognize_bottom_text(temp_path)

            # 3. 分割图标
            with open(temp_path, 'rb') as f:
                image_bytes = f.read()
            pil_icons = segment_icons(image_bytes, total_count)

            # --- 核心修正逻辑：确定最终要返回的数量 ---
            # 如果 OCR 精准识别到了 1-3 个文字，即使图片分割失败（比如只分出1个），我们也以 OCR 数量为准
            num_ocr = len(ocr_names)
            num_pil = len(pil_icons)

            # 判定 OCR 是否可信：数量在1-3之间
            use_ocr_count = 1 <= num_ocr <= 3

            # 最终处理的数量：如果 OCR 可信，取两者最大值
            total_detected = max(num_pil, num_ocr) if use_ocr_count else num_pil

            if total_detected == 0:
                if temp_path and os.path.exists(temp_path): os.remove(temp_path)
                return jsonify({"status": "fail", "reason": "No icons or text detected"}), 404

            batch_results = []
            map_name = f"map{map_num}"

            # 以修正后的总数进行遍历
            for i in range(total_detected):
                # A. 获取图像块进行特征匹配（如果 i 超过了分割块数量，则不进行图像匹配）
                feat_results = []
                if i < num_pil:
                    icon_img = pil_icons[i]
                    feat_results, err = recognizer.match(icon_img, map_num, threshold, top_k=top_k)
                    if feat_results is None: feat_results = []

                # B. 获取 OCR 文字进行模糊匹配
                ocr_match_results = []
                if i < num_ocr:
                    target_word = ocr_names[i]
                    # 获取匹配列表
                    matches = get_top_k_matches(target_word, map_name, names_dict, k=top_k)
                    for m in matches:
                        # 只有当 OCR 匹配准确率（score）大于指定值时才作为强力候选
                        # 或者当没有图像块可用时，我们也接受这个结果
                        full_path = get_icon_full_path(map_name, m['name'])
                        if full_path:
                            ocr_match_results.append({
                                "match_path": full_path,
                                "filename": os.path.basename(full_path),
                                "score": m['score']
                            })

                # C. 合并与去重 (按文件名去重，保留最高分)
                unique_results = {}
                for res in (feat_results + ocr_match_results):
                    f_name = res['filename']
                    if f_name not in unique_results or res['score'] > unique_results[f_name]['score']:
                        unique_results[f_name] = res

                # 排序并截断
                final_candidates = sorted(unique_results.values(), key=lambda x: x['score'], reverse=True)
                final_candidates = final_candidates[:top_k]

                # 剔除逻辑：多于1个结果时剔除最低分
                if len(final_candidates) > 1:
                    final_candidates.pop()

                # D. 注入 view_url 并封装
                res_item = {"index": i}
                if final_candidates:
                    # 检查最高置信度是否满足你的 80% 要求 (可选)
                    # if final_candidates[0]['score'] < 0.8: ...

                    for res in final_candidates:
                        res['view_url'] = url_for('get_icon_file',
                                                  map_name=map_name,
                                                  filename=res['filename'],
                                                  _external=True)
                    res_item.update({"status": "matched", "candidates": final_candidates})
                else:
                    res_item.update({"status": "unmatched", "reason": "Low confidence or no detection"})

                batch_results.append(res_item)

            return jsonify({
                "status": "success",
                "total_detected": total_detected,
                "results": batch_results
            })

        except Exception as e:
            logger.error(e)
            return jsonify({"error": str(e)}), 500

        finally:
            if temp_path and os.path.exists(temp_path):
                try:
                    os.remove(temp_path)
                except:
                    pass