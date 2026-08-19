import sqlite3

from flask import g

import config


def get_db():
    """获取数据库连接（Flask 推荐写法）"""
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(config.ASSETS_FILE)
    return db