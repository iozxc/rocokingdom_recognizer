from flask import request

from settings_manager import settings


def init_routes(app):
    @app.route("/api/settings/capture-mode", methods=["GET"])
    def get_capture_mode():
        return {
            "code": 200,
            "msg": "success",
            "data": {
                "capture_mode": settings.capture_mode
            }
        }

    @app.route("/api/settings/capture-mode/<capture_mode>", methods=["GET"])
    def update_capture_mode(capture_mode):
        if not capture_mode or capture_mode not in ['grab', 'hwnd']:
            return {"code": 400, "msg": "缺少 capture_mode 参数"}


        success, msg = settings.set_capture_mode(capture_mode)
        if success:
            return {
                "status": "success",
                "msg": "修改成功",
                "data": {"capture_mode": settings.capture_mode}
            }
        else:
            return {"status": "fail", "msg": msg}
