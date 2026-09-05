import sqlite3

from flask import g

import config


def get_db():
    """获取数据库连接（Flask 推荐写法），连接打包后的精灵图片库 datasets.db。"""
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(config.DATASETS_PETS)
    return db


def get_ts_db():
    """获取技能/特性图标库连接 datasets_ts.db。"""
    db = getattr(g, '_ts_database', None)
    if db is None:
        db = g._ts_database = sqlite3.connect(config.DATASETS_TS)
    return db


def close_db_connection(exception=None):
    """请求结束后自动关闭数据库连接"""
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()
    ts_db = getattr(g, '_ts_database', None)
    if ts_db is not None:
        ts_db.close()
