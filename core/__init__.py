from flask import Flask

from config import get_resource_path
from core.api import register_blueprints
from core.db import close_db_connection
from flask_cors import CORS


def create_app():
    app = Flask(__name__,
                static_folder=get_resource_path('static'),
                template_folder=get_resource_path('static'))
    CORS(app)
    app.teardown_appcontext(close_db_connection)
    register_blueprints(app)
    return app
