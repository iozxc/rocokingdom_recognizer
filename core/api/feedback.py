import requests
from flask import Blueprint, request

import config
from core.infra.logger import logger
from core.vision.ocr_corrections import add_correction

bp = Blueprint("feedback", __name__)

# 飞书机器人 Webhook（环境变量 ROCO_FEISHU_WEBHOOK_URL 可覆盖）
FEISHU_WEBHOOK_URL = config.FEISHU_WEBHOOK_URL


@bp.route('/api/ocr_correction', methods=['POST'])
def submit_ocr_correction():
    """人工修正回流：把「识别到的旧名 → 用户选中的正确名」写入 OCR 纠错表。

    入参: {wrong: "干棘海针", right: "千棘海针", kind?: "word"|"char"}
    """
    data = request.json or {}
    wrong = str(data.get("wrong") or "").strip()
    right = str(data.get("right") or "").strip()
    kind = data.get("kind") or "word"
    if not wrong or not right or wrong == right:
        return {"status": "error", "message": "wrong/right 无效"}
    ok = add_correction(wrong, right, kind)
    return {"status": "success" if ok else "error"}

@bp.route('/api/submit_feedback', methods=['POST'])
def submit_feedback():
    data = request.json
    fb_type = data.get('type', '功能建议')
    content = data.get('content', '')
    contact = data.get('contact', '未留联系方式')

    # 根据反馈类型设置卡片颜色
    # red: 识别异常, purple: 纠错, orange: 建议
    color = "orange"
    if "异常" in fb_type:
        color = "red"
    elif "纠错" in fb_type:
        color = "purple"

    # 构造飞书消息卡片 (JSON 格式)
    payload = {
        "msg_type": "interactive",
        "card": {
            "config": {"enable_forward": True},
            "header": {
                "template": color,
                "title": {"content": f"📢 新用户反馈: {fb_type}", "tag": "plain_text"}
            },
            "elements": [
                {
                    "tag": "div",
                    "text": {"content": f"**问题描述：**\n{content}", "tag": "lark_md"}
                },
                {
                    "tag": "div",
                    "text": {"content": f"**联系方式：** {contact}\n**关键词：** 洛克反馈", "tag": "lark_md"}
                },
                {
                    "tag": "hr"
                },
                {
                    "tag": "note",
                    "elements": [{"content": "来自 RocoKingdomRecognizer 客户端", "tag": "plain_text"}]
                }
            ]
        }
    }

    try:
        res = requests.post(FEISHU_WEBHOOK_URL, json=payload, timeout=5)
        logger.info(res)
        if res.status_code == 200:
            return {"status": "success"}
    except Exception as e:
        logger.error(e)

    return {"status": "error"}, 500
