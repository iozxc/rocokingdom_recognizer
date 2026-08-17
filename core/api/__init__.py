from core.api.main import init_routes as main_init_routes
from core.api.predict import init_routes as predict_init_routes
from core.api.storage import init_routes as storage_init_routes
from core.api.follow import init_routes as follow_init_routes
from core.api.test import init_routes as test_init_routes



def init_routes(app):
    main_init_routes(app)
    predict_init_routes(app)
    storage_init_routes(app)
    follow_init_routes(app)
    test_init_routes(app)
