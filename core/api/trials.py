"""徽章试炼相关 API：试炼列表与火系试炼的全图鉴自选数据。"""
from flask import Blueprint, url_for

from core.api.response import error, success
from core.services.trials import available_trials, load_pokedex, get_trial
from core.db import get_db
from core.logger import logger

bp = Blueprint("trials", __name__)


def _list_fire_pets(trial_key="fire"):
    """枚举 datasets.db 中的全部精灵图标（每个形态一条），并补上库里没有的全图鉴条目。

    数据集 path 形如 "258_乌达_极夜"（id_名称_形态），展示时只去掉 id 前缀，
    保留形态后缀：乌达_极夜；图片复用原有 /icons/<filename> 接口。
    """
    trial = get_trial(trial_key) or get_trial("fire") or {}
    db = get_db()
    rows = db.execute("SELECT path FROM icons ORDER BY path").fetchall()

    seen_ids = set()
    items = []
    for (path,) in rows:
        path = str(path)
        prefix, sep, rest = path.partition("_")
        if not sep or not prefix.isdigit() or not rest:
            continue
        pet_id = int(prefix)
        seen_ids.add(pet_id)
        items.append({
            "id": pet_id,
            "name": rest,  # 保留形态后缀，如 乌达_极夜
            "url": url_for(
                "main.get_icon_file",
                filename=f"{path}.png",
                trial=trial_key,
                _external=True,
            ),
        })

    # 库里完全没有图的精灵（如 id 440-442）补一条占位条目，前端用生成头像兜底
    for pet in load_pokedex():
        if pet["id"] not in seen_ids:
            items.append({"id": pet["id"], "name": pet["name"]})

    items.sort(key=lambda x: (x["id"], x["name"]))
    return items


@bp.route("/api/trials", methods=["GET"])
def list_trials():
    """返回当前环境可见的试炼列表（打包环境不返回火系）。"""
    try:
        trials = available_trials()
        return success(data={"trials": trials})
    except Exception as e:
        logger.error(f"[GET /api/trials] 异常: {e}", exc_info=True)
        return error(str(e), 500)


@bp.route("/api/trials/<trial_key>/pets", methods=["GET"])
def list_trial_pets(trial_key):
    """试炼返回全图鉴精灵列表（含多形态），并附上图标 URL。"""
    try:
        trial = get_trial(trial_key)
        if trial is None:
            return error("未知的徽章试炼", 404)

        # 仅火系试炼使用全图鉴自选；草系继续走 /icons。
        if trial_key != "fire":
            return error("该试炼不支持全图鉴自选", 400)

        pets = _list_fire_pets(trial_key)
        return success(data={"pets": pets, "count": len(pets)})
    except Exception as e:
        logger.error(f"[GET /api/trials/{trial_key}/pets] 异常: {e}", exc_info=True)
        return error(str(e), 500)


@bp.route("/api/trials/<trial_key>/map_pets", methods=["GET"])
def get_trial_map_pets(trial_key):
    """动态下发指定试炼的地图数据（map_pets JSON），供服务器/前端使用。"""
    try:
        if get_trial(trial_key) is None:
            return error("未知的徽章试炼", 404)
        from core.icon_names import load_map_pets
        data = load_map_pets(trial_key)
        return success(data={"map_pets": data})
    except Exception as e:
        logger.error(f"[GET /api/trials/{trial_key}/map_pets] 异常: {e}", exc_info=True)
        return error(str(e), 500)
