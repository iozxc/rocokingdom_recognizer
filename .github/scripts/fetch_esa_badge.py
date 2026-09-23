#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

DEFAULT_ENDPOINT = "esa.cn-hangzhou.aliyuncs.com"
DEFAULT_SITE = "omisheep.cn"

# 要抓的指标：ESA 字段名 -> (徽章左侧文字, 徽章颜色, 格式化函数名)
METRICS = [
    ("PageView", "网页浏览", "blue", "num"),
    ("Requests", "总请求数", "orange", "num"),
    ("Traffic", "总流量", "5FAD56", "bytes"),
]


def _env(name: str, default: str = "") -> str:
    """读环境变量；空串/纯空白一律当未设置。

    GitHub Actions 里 ${{ vars.X }} 未定义时会展开成空串，如果用 os.getenv(name, default)
    会拿到空串而不是默认值，导致 --site 为空、ListSites 反而返回全部站点并误选第一个。
    """
    val = os.getenv(name)
    return val.strip() if val and val.strip() else default


def _log(msg: str) -> None:
    """统一日志出口。Windows / GBK 环境下强制 UTF-8，避免中文打印崩掉整个脚本。"""
    print(msg, flush=True)


def _force_utf8_stdio() -> None:
    """GitHub Actions 的 Windows runner 默认可能是 GBK，中文 print 会抛 UnicodeEncodeError。"""
    for stream_name in ("stdout", "stderr"):
        stream = getattr(sys, stream_name, None)
        if stream is None:
            continue
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass


class EsaError(RuntimeError):
    """ESA 调用失败（鉴权、参数、限流等），用于给出可读的提示。"""


def _call(fn, *args, **kwargs):
    """包一层 SDK 调用：把 SDK 的异常转成可读的 EsaError。"""
    try:
        return fn(*args, **kwargs)
    except Exception as exc:  # noqa: BLE001 —— 这里就是要兜住 SDK 的各种异常
        msg = str(exc)
        hint = ""
        if "InvalidAccessKeyId" in msg:
            hint = "（AccessKey 无效：检查 ALIBABA_CLOUD_ACCESS_KEY_ID / SECRET 是否配错、是否已禁用）"
        elif "Forbidden" in msg or "NoPermission" in msg:
            hint = "（缺少权限：给该 RAM 用户授予 esa:ListSites / esa:DescribeSiteTimeSeriesData）"
        elif "QuotaCheckFailed" in msg:
            hint = "（套餐不含该功能：ESA 数据分析 API 可能需要更高套餐）"
        elif "TooManyRequests" in msg:
            hint = "（请求过于频繁，稍后重试）"
        elif "InvalidTime" in msg or "TimeRange" in msg:
            hint = "（时间参数不合法：检查 --days，ESA 单次查询上限 31 天）"
        raise EsaError(f"{type(exc).__name__}: {msg}{hint}") from exc


def _fmt_num(n) -> str:
    """整数转人类可读：3865 -> '3.9k'，1234567 -> '1.2M'。"""
    try:
        n = float(n)
    except (TypeError, ValueError):
        return "0"
    for limit, suffix, div in ((1e9, "B", 1e9), (1e6, "M", 1e6), (1e3, "k", 1e3)):
        if n >= limit:
            return f"{n / div:.1f}".rstrip("0").rstrip(".") + suffix
    return str(int(n))


def _fmt_bytes(n) -> str:
    """字节转人类可读：5.54 GB / 812 MB。"""
    try:
        n = float(n)
    except (TypeError, ValueError):
        return "0B"
    for unit, div in (("TB", 1 << 40), ("GB", 1 << 30), ("MB", 1 << 20), ("KB", 1 << 10)):
        if n >= div:
            return f"{n / div:.2f}".rstrip("0").rstrip(".") + " " + unit
    return f"{int(n)} B"


_FORMATTERS = {"num": _fmt_num, "bytes": _fmt_bytes}


def _badge(label: str, message: str, color: str, cache_seconds: int = 1800) -> dict:
    return {
        "schemaVersion": 1,
        "label": label,
        "message": message,
        "color": color,
        "cacheSeconds": cache_seconds,
    }


def _pick_interval(span_seconds: int) -> str:
    """按 ESA 规定的时间粒度上限选择 Interval（只允许 60/300/3600/86400）。"""
    if span_seconds <= 3 * 3600:
        return "60"
    if span_seconds <= 12 * 3600:
        return "300"
    if span_seconds <= 10 * 86400:
        return "3600"
    return "86400"


def _build_client(ak_id: str, ak_secret: str, endpoint: str):
    from alibabacloud_esa20240910.client import Client as EsaClient
    from alibabacloud_tea_openapi import models as open_api_models

    cfg = open_api_models.Config(
        access_key_id=ak_id,
        access_key_secret=ak_secret,
        endpoint=endpoint,
    )
    return EsaClient(cfg)


def _resolve_site_id(client, esa_models, site_name: str) -> str:
    """调 ListSites 找到站点 ID：先精确匹配，再退化为模糊匹配取第一个。"""
    resp = _call(client.list_sites, esa_models.ListSitesRequest(
        site_name=site_name,
        site_search_type="fuzzy",
        page_number=1,
        page_size=100,
    ))
    sites = list(getattr(resp.body, "sites", None) or [])
    if not sites:
        raise RuntimeError(f"ListSites 没返回任何站点（查询名：{site_name}）")

    for s in sites:
        if getattr(s, "site_name", None) == site_name:
            _log(f"  站点精确匹配：{s.site_name} -> SiteId={s.site_id}")
            return str(s.site_id)
    first = sites[0]
    _log(f"  未精确匹配，改用第一个：{first.site_name} -> SiteId={first.site_id}")
    _log("  可用站点：" + ", ".join(str(getattr(s, "site_name", "?")) for s in sites[:10]))
    return str(first.site_id)


def _query(client, esa_models, site_id: str, start: str, end: str, interval: str):
    """一次调用同时取多个指标（Fields 支持传数组）。"""
    fields = [
        esa_models.DescribeSiteTimeSeriesDataRequestFields(
            field_name=name,
            dimension=["ALL"],
        )
        for name, _, _, _ in METRICS
    ]
    req = esa_models.DescribeSiteTimeSeriesDataRequest(
        site_id=site_id,
        start_time=start,
        end_time=end,
        interval=interval,
        fields=fields,
    )
    return _call(client.describe_site_time_series_data, req)


def _collect(resp) -> dict:
    """把响应拆成 {指标: {'total': 数值, 'series': [(ts, value), ...]}}。"""
    out = {}
    for item in (getattr(resp.body, "data", None) or []):
        name = getattr(item, "field_name", None)
        if not name:
            continue
        series = []
        for pt in (getattr(item, "detail_data", None) or []):
            try:
                series.append((getattr(pt, "time_stamp", None), float(getattr(pt, "value", 0) or 0)))
            except (TypeError, ValueError):
                continue
        out.setdefault(name, {"series": []})["series"] = series

    # 汇总值优先用 SummarizedData，没有就自己把明细加起来
    for item in (getattr(resp.body, "summarized_data", None) or []):
        name = getattr(item, "field_name", None)
        if not name:
            continue
        try:
            out.setdefault(name, {"series": []})["total"] = float(getattr(item, "value", 0) or 0)
        except (TypeError, ValueError):
            pass

    for name, payload in out.items():
        if "total" not in payload:
            payload["total"] = sum(v for _, v in payload.get("series") or [])

    meta = {
        "interval": getattr(resp.body, "interval", None),
        "sampling_rate": getattr(resp.body, "sampling_rate", None),
        "start_time": getattr(resp.body, "start_time", None),
        "end_time": getattr(resp.body, "end_time", None),
        "request_id": getattr(resp.body, "request_id", None),
    }
    return out, meta


def _peak_bandwidth(series, interval_seconds: int) -> float:
    """带宽峰值（bps）：把每个时间片的字节数除以片长再乘 8，取最大值。"""
    if not series or interval_seconds <= 0:
        return 0.0
    peak = 0.0
    for _, v in series:
        bps = (float(v) / interval_seconds) * 8.0
        peak = max(peak, bps)
    return peak


def _fmt_bps(bps: float) -> str:
    for unit, div in (("Gbps", 1e9), ("Mbps", 1e6), ("Kbps", 1e3)):
        if bps >= div:
            return f"{bps / div:.2f} {unit}"
    return f"{bps:.0f} bps"


def main() -> int:
    ap = argparse.ArgumentParser(description="抓取 ESA 流量指标并生成 shields.io 徽章 JSON")
    ap.add_argument("--site", default=_env("ESA_SITE_NAME", DEFAULT_SITE), help="ESA 站点名（默认 omisheep.cn）")
    ap.add_argument("--site-id", default=_env("ESA_SITE_ID", ""), help="已知 SiteId（给了就跳过 ListSites）")
    ap.add_argument("--endpoint", default=_env("ESA_ENDPOINT", DEFAULT_ENDPOINT))
    ap.add_argument("--days", type=int, default=30, help="统计最近多少天（ESA 单次上限 31 天）")
    ap.add_argument("--out", default="badges", help="徽章 JSON 输出目录")
    ap.add_argument("--dry-run", action="store_true", help="只打印结果，不写文件")
    args = ap.parse_args()

    _force_utf8_stdio()

    ak_id = _env("ALIBABA_CLOUD_ACCESS_KEY_ID")
    ak_secret = _env("ALIBABA_CLOUD_ACCESS_KEY_SECRET")
    if not ak_id or not ak_secret:
        _log("错误：缺少 ALIBABA_CLOUD_ACCESS_KEY_ID / ALIBABA_CLOUD_ACCESS_KEY_SECRET")
        return 2

    days = max(1, min(args.days, 31))
    end_dt = datetime.now(timezone.utc)
    start_dt = end_dt - timedelta(days=days)
    start = start_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    end = end_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    interval = _pick_interval(int((end_dt - start_dt).total_seconds()))

    _log(f"ESA 抓取：site={args.site} days={days} interval={interval}s")
    _log(f"  时间窗 {start} ~ {end}")

    from alibabacloud_esa20240910 import models as esa_models

    client = _build_client(ak_id, ak_secret, args.endpoint)

    site_id = args.site_id.strip()
    if not site_id:
        site_id = _resolve_site_id(client, esa_models, args.site)

    resp = _query(client, esa_models, site_id, start, end, interval)
    data, meta = _collect(resp)
    _log(f"  采样率={meta.get('sampling_rate')}% requestId={meta.get('request_id')}")

    badges = {}
    lines = []

    for name, label, color, fmt in METRICS:
        payload = data.get(name)
        if not payload or not payload.get("total"):
            _log(f"  [!] 指标 {name} 无数据，跳过（保留旧徽章）")
            continue
        total = payload["total"]
        msg = _FORMATTERS[fmt](total)
        badges[f"{name.lower()}.json"] = _badge(label, msg, color)
        lines.append(f"  {label:<8} {msg}")

    traffic = data.get("Traffic") or {}
    peak = _peak_bandwidth(traffic.get("series") or [], int(interval))
    if peak > 0:
        badges["bandwidth.json"] = _badge("带宽峰值", _fmt_bps(peak), "blueviolet")
        lines.append(f"  {'带宽峰值':<8} {_fmt_bps(peak)}")

    if not badges:
        _log("错误：所有指标都没有数据，不做任何写入（避免把好数据覆盖成空）")
        return 1

    stats = {
        "generated_at": end,
        "period_days": days,
        "site": args.site,
        "site_id": site_id,
        "interval_seconds": int(interval),
        "sampling_rate": meta.get("sampling_rate"),
        "metrics": {k: v.get("total") for k, v in data.items()},
        "peak_bandwidth_bps": peak,
    }

    _log("结果：")
    for line in lines:
        _log(line)

    if args.dry_run:
        _log("--dry-run：不写文件")
        return 0

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    for fname, payload in badges.items():
        (out / fname).write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
    (out / "stats.json").write_text(
        json.dumps(stats, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    _log(f"已写入 {len(badges) + 1} 个文件到 {out}/")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except EsaError as err:
        _log("ESA 调用失败：" + str(err))
        sys.exit(3)