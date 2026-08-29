import os
import tempfile

from flask import Blueprint, request, url_for
from PIL import Image

import config
from core.api.response import error, success
from core.services.icon_catalog import icon_catalog
from core.services.trials import get_trial
from core.services.trial_filter import filter_candidates_by_trial
from core.utils import get_top_k_matches, get_icon_file_name
from core.logger import logger
from core.auth_service import is_authorized

bp = Blueprint("predict", __name__)


def f(image):
    from core.ocr import ocr
    ocr_names = ocr().recognize_bottom_text(image)
    return ocr_names


def ocr_top_k_match(image, map_num, top_k=6, trial_key="grass"):
    from core.ocr import ocr
    logger.debug(f"OCR top-k匹配开始: map_num={map_num}, top_k={top_k}")

    name = ocr().recognize_single_bottom_text(image)

    if not name:
        logger.debug("OCR未识别到文字，返回空列表")
        return []

    logger.debug(f"OCR识别文字: '{name}'")

    map_key = f"map{map_num}"
    raw_result_list = get_top_k_matches(name, map_key, icon_catalog.get_names(trial_key), top_k)

    final_ocr_results = []
    for item in raw_result_list:
        # 保留完整数据集文件名（含 id 与形态序号），供 /icons/<filename> 直接查库；
        # 展示名由前端用 matchedPet.name（/icons 已剥离）或 formatPetName 处理。
        file_name = get_icon_file_name(map_key, item['name'], trial_key)

        if file_name:
            final_ocr_results.append({
                "match_path": file_name,
                "filename": os.path.basename(file_name),  # 数据集文件名，如 258_乌达_极夜.png
                "score": item['score']
            })

    logger.debug(f"OCR模糊匹配完成: 原始候选={len(raw_result_list)}, 有效结果={len(final_ocr_results)}")
    return final_ocr_results


@bp.route('/predict', methods=['POST'])
def predict():
    if not is_authorized():
        return error("请授权，解锁更多功能", 200)
    logger.info(f"[/predict] 请求开始, map_num={request.form.get('map_num')}, "
                f"threshold={request.form.get('threshold')}, top_k={request.form.get('top_k')}, "
                f"trial={request.form.get('trial', 'grass')}")

    if 'image' not in request.files:
        logger.warning("[/predict] 请求中无image字段")
        return error("No image", 400)

    file = request.files.get('image')
    map_num = request.form.get('map_num', 1)
    trial_key = request.form.get('trial', 'grass')
    threshold = float(request.form.get('threshold', config.DEFAULT_THRESHOLD))
    top_k = int(request.form.get('top_k', config.DEFAULT_TOPK))

    if get_trial(trial_key) is None:
        return error(f"未知的徽章试炼: {trial_key}", 400)

    if not file:
        logger.warning("[/predict] image文件为空")
        return error("No image uploaded", 400)

    try:
        from core.services.recognizers import models
        with tempfile.NamedTemporaryFile(delete=False, suffix='.png') as temp_file:
            temp_path = temp_file.name
            file.save(temp_path)

        img = Image.open(temp_path).convert('RGB')
        logger.debug(f"[/predict] 图片尺寸: {img.size}")

        recognizer = models.get_icon_recognizer()
        if recognizer is None:
            return error(f"试炼 {trial_key} 的图标特征库不可用", 500)
        # 全图鉴匹配时多取候选，白名单过滤后仍能凑够 topk
        match_pool_k = max(top_k * 4, 24)
        feat_results, err = recognizer.match(img, threshold, top_k=match_pool_k)
        logger.debug(f"[/predict] 特征匹配: 结果数={len(feat_results) if feat_results else 0}, err={err}")

        if err:
            logger.warning(f"[/predict] 特征匹配返回错误: {err}")
            return error(err, 500)

        ocr_results = ocr_top_k_match(temp_path, map_num, top_k, trial_key)
        logger.debug(f"[/predict] OCR匹配结果数: {len(ocr_results)}")

        combined_results = feat_results + ocr_results

        # 去重：如果同一个文件既被特征匹配到，也被 OCR 匹配到，取分数高的那个
        unique_results = {}
        for res in combined_results:
            path = res['match_path']
            if path not in unique_results or res['score'] > unique_results[path]['score']:
                unique_results[path] = res

        final_list = filter_candidates_by_trial(
            list(unique_results.values()), trial_key, map_name=f"map{map_num}"
        )

        final_list.sort(key=lambda x: x['score'], reverse=True)

        final_list = final_list[:top_k]

        if os.path.exists(temp_path):
            os.remove(temp_path)

        if final_list:
            map_name = f"map{map_num}"
            for res in final_list:
                icon_kwargs = {
                    "filename": res['filename'],
                    "_external": True,
                }
                if trial_key != "grass":
                    icon_kwargs["trial"] = trial_key
                res['view_url'] = url_for('main.get_icon_file', **icon_kwargs)

            top1 = final_list[0]
            logger.info(f"[/predict] 预测成功: top1={top1['filename']}({top1['score']:.3f}), "
                        f"共{len(final_list)}个候选")
            return success(data=final_list, count=len(final_list))

        logger.info(f"[/predict] 无匹配结果, err={err}")
        return error(err or "未识别到匹配项", 404)

    except Exception as e:
        logger.error(f"[/predict] 处理异常: {e}", exc_info=True)
        return error(str(e), 500)

@bp.route('/init_batch', methods=['POST'])
def predict_batch():
    if not is_authorized():
        return error("请授权，解锁更多功能", 200)
    logger.info(f"[/init_batch] 请求开始, map_num={request.form.get('map_num')}, "
                f"threshold={request.form.get('threshold')}, top_k={request.form.get('top_k')}, "
                f"total_count={request.form.get('total_count')}, trial={request.form.get('trial', 'grass')}")

    if 'image' not in request.files:
        logger.warning("[/init_batch] 请求中无image字段")
        return error("No image uploaded", 400)

    file = request.files['image']
    map_num = int(request.form.get('map_num', 1))
    trial_key = request.form.get('trial', 'grass')
    threshold = float(request.form.get('threshold', config.DEFAULT_THRESHOLD))
    top_k = int(request.form.get('top_k', 6))
    total_count = int(request.form.get('total_count', 999))

    if get_trial(trial_key) is None:
        return error(f"未知的徽章试炼: {trial_key}", 400)

    temp_path = None
    try:
        from core.ocr import ocr
        from core.processor import segment_icons
        from core.services.recognizers import models
        with tempfile.NamedTemporaryFile(delete=False, suffix='.png') as tmp:
            temp_path = tmp.name
            file.save(temp_path)

        ocr_names = ocr().recognize_bottom_text(temp_path)
        logger.debug(f"[/init_batch] OCR识别名字列表: {ocr_names}")

        with open(temp_path, 'rb') as f:
            image_bytes = f.read()
        pil_icons = segment_icons(image_bytes, total_count)
        logger.debug(f"[/init_batch] 图标分割数量: {len(pil_icons)}")

        num_ocr = len(ocr_names)
        num_pil = len(pil_icons)

        use_ocr_count = 1 <= num_ocr <= 3

        total_detected = max(num_pil, num_ocr) if use_ocr_count else num_pil

        logger.debug(f"[/init_batch] 数量决策: num_ocr={num_ocr}, num_pil={num_pil}, "
                    f"use_ocr_count={use_ocr_count}, total_detected={total_detected}")

        if total_detected == 0:
            if temp_path and os.path.exists(temp_path): os.remove(temp_path)
            logger.info("[/init_batch] 未检测到图标或文字，返回404")
            return error("No icons or text detected", 404)

        batch_results = []
        map_name = f"map{map_num}"

        for i in range(total_detected):
            # A. 获取图像块进行特征匹配（如果 i 超过了分割块数量，则不进行图像匹配）
            feat_results = []
            if i < num_pil:
                icon_img = pil_icons[i]
                recognizer = models.get_icon_recognizer()
                if recognizer is None:
                    logger.warning(f"试炼 {trial_key} 的图标特征库不可用，跳过特征匹配")
                else:
                    # 全图鉴匹配时多取候选，白名单过滤后仍能凑够 topk
                    match_pool_k = max(top_k * 4, 24)
                    raw_feat, err = recognizer.match(icon_img, threshold, top_k=match_pool_k)
                    feat_results = filter_candidates_by_trial(
                        raw_feat, trial_key, map_name=map_name
                    )

            # B. 获取 OCR 文字进行模糊匹配
            ocr_match_results = []
            if i < num_ocr:
                target_word = ocr_names[i]
                # 获取匹配列表
                matches = get_top_k_matches(target_word, map_name, icon_catalog.get_names(trial_key), k=top_k)
                for m in matches:
                    # 只有当 OCR 匹配准确率（score）大于指定值时才作为强力候选
                    # 或者当没有图像块可用时，也接受这个结果
                    file_name = get_icon_file_name(map_name, m['name'], trial_key)
                    if file_name:
                        ocr_match_results.append({
                            "match_path": file_name,
                            "filename": os.path.basename(file_name),
                            "score": m['score']
                        })

            # B'  OCR 结果也按当前 map 白名单过滤
            ocr_match_results = filter_candidates_by_trial(
                ocr_match_results, trial_key, map_name=map_name
            )

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
                    icon_kwargs = {
                        "filename": res['filename'],
                        "_external": True,
                    }
                    if trial_key != "grass":
                        icon_kwargs["trial"] = trial_key
                    res['view_url'] = url_for('main.get_icon_file', **icon_kwargs)
                res_item.update({"status": "matched", "candidates": final_candidates})
                top1 = final_candidates[0]
                logger.debug(f"[/init_batch] 槽位{i}: matched -> {top1['filename']}({top1['score']:.3f}), "
                            f"候选数={len(final_candidates)}")
            else:
                res_item.update({"status": "unmatched", "reason": "Low confidence or no detection"})
                logger.debug(f"[/init_batch] 槽位{i}: unmatched")

            batch_results.append(res_item)

        matched = sum(1 for r in batch_results if r['status'] == 'matched')
        logger.info(f"[/init_batch] 批量预测完成: total={total_detected}, matched={matched}, "
                   f"unmatched={total_detected - matched}")

        return success(total_detected=total_detected, results=batch_results)

    except Exception as e:
        logger.error(f"[/init_batch] 批量预测异常: {e}", exc_info=True)
        return error(str(e), 500)

    finally:
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception as e:
                logger.warning(f"[/init_batch] 临时文件清理失败: {e}")
