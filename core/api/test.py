from core.utils import scan_icon_names


def init_routes(app):
    @app.route('/teeeeeeeeeeeeeeest', methods=['GET'])
    def teeeeeeeeeeest():
        return scan_icon_names()