"""徽章试炼相关 API：试炼列表与火系试炼的全图鉴自选数据。"""
from flask import Blueprint, url_for

from core.api.response import error, success
from core.services.trials import available_trials, load_pokedex, get_trial
from core.db import get_db
from core.logger import logger

bp = Blueprint("trials", __name__)


def _list_fire_pets(trial_key="fire"):
    """枚举 datasets.db 中的全部精灵图标（每个形态一条），并补上库里没有的全图鉴条目。

    数据集 path 形如 "001_01_迪莫"（id_形态序号_名字）或 "002_喵喵"（id_名字）。
    数据库已存 id/seq/name 字段：展示名直接用 name（已去 id 与形态序号）；
    排序按 (id, seq) 分多形态排序，seq 为 NULL 视为 0。
    图片复用原有 /icons/<filename> 接口。
    """
    trial = get_trial(trial_key) or get_trial("fire") or {}
    db = get_db()
    rows = db.execute(
        "SELECT path, id, seq, name FROM icons"
    ).fetchall()

    seen_ids = set()
    items = []
    for path, pet_id, seq, name in rows:
        path = str(path)
        if pet_id is None:
            continue
        pet_id = int(pet_id)
        seen_ids.add(pet_id)
        display_name = name if name else str(path)
        items.append({
            "id": pet_id,
            "seq": int(seq) if seq is not None else None,
            "name": display_name,
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

    items.sort(key=lambda x: (x["id"], x.get("seq") or 0, x.get("name") or ""))
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
