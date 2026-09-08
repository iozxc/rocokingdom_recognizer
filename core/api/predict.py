import base64
import io
import os
import tempfile

from flask import Blueprint, request, url_for
from PIL import Image

import config
from core.api.response import error, success
from core.services.icon_catalog import icon_catalog
from core.services.trials import get_trial
from core.services.trial_filter import (
    allowed_pet_names,
    filter_candidates_by_allowed,
    filter_candidates_by_trial,
)
from core.infra.utils import get_top_k_matches, get_icon_file_name, fuse_ocr_feat
from core.infra.logger import logger
from core.auth.service import is_authorized

bp = Blueprint("predict", __name__)


def _pil_to_data_uri(img, fmt="PNG"):
    """把裁剪出的 PIL 小图编码成 data URI(base64)，随识别结果一次性回传，
    供前端与图鉴候选并排核对，无需为裁剪图另开静态资源或临时文件。"""
    try:
        buf = io.BytesIO()
        img.save(buf, format=fmt, optimize=True)
        b64 = base64.b64encode(buf.getvalue()).decode("ascii")
        return f"data:image/{fmt.lower()};base64,{b64}"
    except Exception:
        logger.warning("裁剪图 data URI 编码失败，已跳过 crop_image", exc_info=True)
        return None


def _has_cjk(text):
    """精灵名均为中文；用于剔除 OCR 把圆形/纹理误判成 'O'/'Ua' 这类假名字。"""
    return any('\u4e00' <= ch <= '\u9fa5' for ch in (text or ""))


def _segment_looks_bad(pil_icons, expect_n, flat_aspect=2.5):
    """只识别原连通域分割“明确失败”的强信号，宁可漏兜底也不可误伤正确结果。

    - 一块都没切出（且确实有名字）-> empty；
    - 切出块数已 >= 名字数：说明分割充分，一律视为正常，绝不兜底覆盖；
    - 块数 < 名字数（有头像漏切/粘连）且存在宽高比 >= flat_aspect 的严重扁条
      （多只被粘连成一条的铁证；正常单个头像宽高比仅 1.0~1.4）-> merged_flat。
    绝不能用“块数 != 名字数”当失败理由：纯头像网格 OCR 会误检出字母，
    图标也可能本就没有名字，数量天然可能不等。
    """
    if not pil_icons:
        return "empty" if expect_n > 0 else None
    if len(pil_icons) >= expect_n:
        return None
    for im in pil_icons:
        w, h = im.size
        if min(w, h) > 0 and max(w, h) / float(min(w, h)) >= flat_aspect:
            return "merged_flat"
    return None


def ocr_top_k_match(image, stage_num, top_k=6, trial_key="grass"):
    from core.vision.ocr import ocr
    logger.debug(f"OCR top-k匹配开始: stage_num={stage_num}, top_k={top_k}")

    name = ocr().recognize_single_bottom_text(image)

    if not name:
        logger.debug("OCR未识别到文字，返回空列表")
        return []

    logger.debug(f"OCR识别文字: '{name}'")

    map_key = f"map{stage_num}"
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
                "score": item['score'],
                "seq_tag": bool(item.get('seq_tag', False)),
            })

    logger.debug(f"OCR模糊匹配完成: 原始候选={len(raw_result_list)}, 有效结果={len(final_ocr_results)}")
    return final_ocr_results


@bp.route('/predict', methods=['POST'])
def predict():
    if not is_authorized():
        return error("请授权，解锁更多功能", 200)
    logger.info(f"[/predict] 请求开始, stage_num={request.form.get('stage_num')}, "
                f"threshold={request.form.get('threshold')}, top_k={request.form.get('top_k')}, "
                f"trial={request.form.get('trial', 'grass')}")

    if 'image' not in request.files:
        logger.warning("[/predict] 请求中无image字段")
        return error("No image", 400)

    file = request.files.get('image')
    trial_key = request.form.get('trial', 'grass')

    # 参数解析：非法参数明确返回 400，而不是走到 500
    try:
        stage_num = int(request.form.get('stage_num', 1))
        threshold = float(request.form.get('threshold', config.DEFAULT_THRESHOLD))
        top_k = int(request.form.get('top_k', config.DEFAULT_TOPK))
    except (TypeError, ValueError):
        logger.warning(f"[/predict] 参数格式非法: stage_num={request.form.get('stage_num')}, "
                       f"threshold={request.form.get('threshold')}, top_k={request.form.get('top_k')}")
        return error("参数格式错误", 400)

    if get_trial(trial_key) is None:
        return error(f"未知的徽章试炼: {trial_key}", 400)

    if not file:
        logger.warning("[/predict] image文件为空")
        return error("No image uploaded", 400)

    temp_path = None
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

        ocr_results = ocr_top_k_match(temp_path, stage_num, top_k, trial_key)
        logger.debug(f"[/predict] OCR匹配结果数: {len(ocr_results)}")

        # 特调：OCR 多形态名字(seq_tag)按特征(图像)置信度加权
        ocr_results = fuse_ocr_feat(ocr_results, feat_results)
        combined_results = feat_results + ocr_results

        # 去重：如果同一个文件既被特征匹配到，也被 OCR 匹配到，取分数高的那个
        unique_results = {}
        for res in combined_results:
            path = res['match_path']
            if path not in unique_results or res['score'] > unique_results[path]['score']:
                unique_results[path] = res

        final_list = filter_candidates_by_trial(
            list(unique_results.values()), trial_key, map_name=f"map{stage_num}"
        )

        final_list.sort(key=lambda x: x['score'], reverse=True)

        final_list = final_list[:top_k]

        if final_list:
            map_name = f"map{stage_num}"
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
    finally:
        # 统一清理临时文件：任何提前 return / 异常都不会泄漏
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception as e:
                logger.warning(f"[/predict] 临时文件清理失败: {e}")

@bp.route('/init_batch', methods=['POST'])
def predict_batch():
    if not is_authorized():
        return error("请授权，解锁更多功能", 200)
    logger.info(f"[/init_batch] 请求开始, stage_num={request.form.get('stage_num')}, "
                f"threshold={request.form.get('threshold')}, top_k={request.form.get('top_k')}, "
                f"total_count={request.form.get('total_count')}, trial={request.form.get('trial', 'grass')}")

    if 'image' not in request.files:
        logger.warning("[/init_batch] 请求中无image字段")
        return error("No image uploaded", 400)

    file = request.files['image']
    stage_num = int(request.form.get('stage_num', 1))
    trial_key = request.form.get('trial', 'grass')
    threshold = float(request.form.get('threshold', config.DEFAULT_THRESHOLD))
    top_k = int(request.form.get('top_k', 6))
    total_count = int(request.form.get('total_count', 999))

    if get_trial(trial_key) is None:
        return error(f"未知的徽章试炼: {trial_key}", 400)

    temp_path = None
    try:
        from core.vision.ocr import ocr
        from core.vision.processor import segment_icons, segment_icons_by_name_anchors
        from core.services.recognizers import models
        with tempfile.NamedTemporaryFile(delete=False, suffix='.png') as tmp:
            temp_path = tmp.name
            file.save(temp_path)

        bottom_items = ocr().recognize_bottom_items(temp_path)
        ocr_names = [b['text'] for b in bottom_items]
        logger.debug(f"[/init_batch] OCR识别名字列表: {ocr_names}")

        with open(temp_path, 'rb') as f:
            image_bytes = f.read()
        pil_icons = segment_icons(image_bytes, total_count)
        logger.debug(f"[/init_batch] 图标分割数量: {len(pil_icons)}")

        # 名字锚定兜底（可用 config.ENABLE_NAME_ANCHOR_FALLBACK 一键关闭，关闭后与原逻辑完全一致）。
        # 铁律：只在原连通域分割“明确失败”时救场，且兜底结果只增不减——
        # 绝不允许把原算法切对的多块覆盖成更少块。
        # 1) 只采用中文名字项，剔除 OCR 在纯头像图上把图案误判成 'O'/'Ua' 之类假文字；
        anchor_items = [b for b in bottom_items if _has_cjk(b.get('text', ''))]
        if getattr(config, 'ENABLE_NAME_ANCHOR_FALLBACK', True) and 1 <= len(anchor_items) <= 3:
            bad_reason = _segment_looks_bad(pil_icons, len(anchor_items))
            if bad_reason:
                anchored_icons = segment_icons_by_name_anchors(image_bytes, anchor_items)
                # 2) 只增不减 + 数量对齐名字 + 每块近正方，任一不满足就保留原算法结果
                anchors_square = all(
                    min(im.size) > 0 and max(im.size) / float(min(im.size)) <= 1.5
                    for im in anchored_icons
                )
                if (len(anchored_icons) == len(anchor_items)
                        and len(anchored_icons) >= len(pil_icons)
                        and anchors_square):
                    logger.info(
                        f"[/init_batch] 原连通域分割失败({bad_reason}, 原{len(pil_icons)}块)，"
                        f"名字锚定兜底切割 {len(anchored_icons)} 块"
                    )
                    pil_icons = anchored_icons
                else:
                    logger.debug(
                        f"[/init_batch] 名字锚定未通过只增不减/近正方校验"
                        f"(锚定{len(anchored_icons)} 原{len(pil_icons)} 名字{len(anchor_items)})，保留原分割"
                    )

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
        map_name = f"map{stage_num}"

        # 只取一次识别器与白名单，避免循环内重复懒加载模型 / 重复扫描图标目录
        recognizer = models.get_icon_recognizer()
        if num_pil and recognizer is None:
            logger.warning(f"试炼 {trial_key} 的图标特征库不可用，本次批量特征匹配将全部跳过")
        allowed_names = allowed_pet_names(trial_key, map_name)

        # 所有图标一次性/分块提取特征（单次 ONNX 推理），随后逐槽仅做特征检索，
        # 避免每个图标单独 preprocess + onnx session.run 的开销。
        feat_matrix = None
        if num_pil and recognizer is not None:
            try:
                feat_matrix = recognizer.get_feature_batch(pil_icons)
                logger.debug(f"[/init_batch] 批量特征提取完成: N={num_pil}, shape={feat_matrix.shape}")
            except Exception as e:
                logger.error(f"[/init_batch] 批量特征提取失败，回退为逐图标匹配: {e}", exc_info=True)
                feat_matrix = None

        for i in range(total_detected):
            # A. 获取图像块进行特征匹配（如果 i 超过了分割块数量，则不进行图像匹配）
            feat_results = []
            if i < num_pil:
                icon_img = pil_icons[i]
                if recognizer is None:
                    logger.warning(f"试炼 {trial_key} 的图标特征库不可用，跳过特征匹配")
                else:
                    # 全图鉴匹配时多取候选，白名单过滤后仍能凑够 topk
                    match_pool_k = max(top_k * 4, 24)
                    if feat_matrix is not None:
                        raw_feat, err = recognizer.match_from_feature(
                            feat_matrix[i], threshold, top_k=match_pool_k
                        )
                    else:
                        raw_feat, err = recognizer.match(icon_img, threshold, top_k=match_pool_k)
                    feat_results = filter_candidates_by_allowed(raw_feat, allowed_names)

            # B. 获取 OCR 文字进行模糊匹配
            ocr_match_results = []
            if i < num_ocr:
                target_word = ocr_names[i]
                # 获取匹配列表
                matches = get_top_k_matches(target_word, map_name, icon_catalog.get_names(trial_key), k=top_k)
                for m in matches:
                    # 只有当 OCR 匹配准确率（score）大于指定值时才作为强力候选
                    # 或者当没有图像块可用时，也接受这个结果
                    if m['score'] <= 0.1: continue
                    file_name = get_icon_file_name(map_name, m['name'], trial_key)
                    if file_name:
                        ocr_match_results.append({
                            "match_path": file_name,
                            "filename": os.path.basename(file_name),
                            "score": m['score'],
                            "seq_tag": bool(m.get('seq_tag', False)),
                        })

            # B'  OCR 结果也按当前 map 白名单过滤（复用一次性算好的白名单）
            ocr_match_results = filter_candidates_by_allowed(ocr_match_results, allowed_names)

            # C. 合并与去重 (按文件名去重，保留最高分)
            ocr_match_results = fuse_ocr_feat(ocr_match_results, feat_results)
            unique_results = {}
            for res in (feat_results + ocr_match_results):
                f_name = res['filename']
                if f_name not in unique_results or res['score'] > unique_results[f_name]['score']:
                    unique_results[f_name] = res

            # 排序并截断
            final_candidates = sorted(unique_results.values(), key=lambda x: x['score'], reverse=True)
            final_candidates = final_candidates[:top_k]


            # D. 注入 view_url 并封装
            res_item = {"index": i}
            # 回传该槽位从用户整图中实际裁剪出的小图，供前端与候选图鉴图并排核对多形态
            if i < num_pil:
                crop_uri = _pil_to_data_uri(pil_icons[i])
                if crop_uri:
                    res_item["crop_image"] = crop_uri
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
