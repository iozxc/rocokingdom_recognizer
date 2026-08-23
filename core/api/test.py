from flask import Blueprint

bp = Blueprint("test", __name__)


@bp.route('/teeeeeeeeeeeeeeest', methods=['GET'])
def teeeeeeeeeeest():
    return "teeeeeeeeeeeeeeest"
