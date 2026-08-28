from core.api.feedback import bp as feedback_bp
from core.api.follow import bp as follow_bp
from core.api.data_updater import bp as data_updater_bp
from core.api.main import bp as main_bp
from core.api.predict import bp as predict_bp
from core.api.storage import bp as storage_bp
from core.api.trials import bp as trials_bp
from core.api.seek import bp as seek_bp
from core.api.updater import bp as updater_bp


def register_blueprints(app):
    """注册全部 API 蓝图，URL 与重构前保持一致"""
    app.register_blueprint(main_bp)
    app.register_blueprint(predict_bp)
    app.register_blueprint(storage_bp)
    app.register_blueprint(trials_bp)
    app.register_blueprint(follow_bp)
    app.register_blueprint(feedback_bp)
    app.register_blueprint(data_updater_bp)
    app.register_blueprint(updater_bp)
