from flask import Flask

from config import get_resource_path
from core.api import register_blueprints
from core.api.response import error as api_error
from core.db import close_db_connection
from flask_cors import CORS
from core.logger import logger


def create_app():
    app = Flask(__name__,
                static_folder=get_resource_path('static'),
                template_folder=get_resource_path('static'))
    CORS(app)
    app.teardown_appcontext(close_db_connection)
    register_blueprints(app)
    _register_error_handlers(app)
    return app


def _register_error_handlers(app):
    """全局错误处理：未捕获异常与 404 统一返回 JSON 而非 HTML 错误页。"""

    @app.errorhandler(404)
    def not_found(e):
        return api_error("Not Found", 404)

    @app.errorhandler(405)
    def method_not_allowed(e):
        return api_error("Method Not Allowed", 405)

    @app.errorhandler(500)
    def internal_error(e):
        logger.error(f"未处理的服务器异常: {e}", exc_info=True)
        return api_error("服务器内部错误", 500)
