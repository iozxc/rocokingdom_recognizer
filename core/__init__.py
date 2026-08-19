from flask import Flask

from config import get_resource_path
from core.api import init_routes
from flask_cors import CORS


def create_app():
    app = Flask(__name__,
                static_folder=get_resource_path('static'),
                template_folder=get_resource_path('static'))
    CORS(app)
    init_routes(app)
    return app
