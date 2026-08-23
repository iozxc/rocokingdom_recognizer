"""统一的 API 响应辅助函数。

约定：
- 成功：{"status": "success", "message": "...", ...业务字段}
- 失败：{"status": "error", "message": "...", ...业务字段}

注意：/api/storage、/api/download_progress、/api/check_update 等接口因前端
契约特殊（如 {"ok": true, "version": ...}、扁平进度字段），保持各自原有格式。
"""


def success(data=None, message="success", **extra):
    """构造成功响应体（调用方直接 return）。"""
    body = {"status": "success", "message": message}
    if data is not None:
        body["data"] = data
    body.update(extra)
    return body


def error(message, http_status=500, **extra):
    """构造失败响应 (body, http_status) 元组。"""
    body = {"status": "error", "message": message}
    body.update(extra)
    return body, http_status
