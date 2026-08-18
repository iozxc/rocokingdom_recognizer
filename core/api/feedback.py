import requests
from flask import request

from core.utils import logger

# 你刚才保存的 Webhook 地址
FEISHU_WEBHOOK_URL = "https://open.feishu.cn/open-apis/bot/v2/hook/921e10c3-1b75-4759-9897-4c974bc20aab"

def init_routes(app):
    @app.route('/api/submit_feedback', methods=['POST'])
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