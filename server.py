#!/usr/bin/env python3
"""天气数据看板 · 零依赖后端

只用 Python 标准库，不需要 pip install 任何东西。

    python server.py            # 默认 127.0.0.1:8848
    python server.py --port 9000

接口
    GET  /                                  页面
    GET  /assets/*                          静态资源
    GET  /api/weather?cities=北京,汕头&days=30[&end=YYYY-MM-DD][&force=1]
                                            抓取 + 清洗 + 统计，返回 JSON
    GET  /api/geocode?q=汕头                 城市搜索（转发 Open-Meteo Geocoding）
    GET  /api/health                        健康检查

设计要点
    · 用户点"抓取"才真的发请求（对应页面第②段），不做预生成
    · 同一 (城市集合, 天数, 结束日) 6 小时内命中磁盘缓存，响应里标 cache_hit 与缓存时间
    · 多城市合并成一次请求（Open-Meteo 支持逗号分隔坐标），超过 8 城自动分批
    · 原始响应按字节落盘到 cache/raw/，附 sha256，任何数字都能追回原始报文
    · 清洗与统计全部纯 Python 实现（无 pandas），保证"双击即可运行"
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import mimetypes
import os
import re
import socket
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ASSETS = ROOT / "assets"
CACHE = ROOT / "cache"
RAW = CACHE / "raw"
for d in (CACHE, RAW):
    d.mkdir(parents=True, exist_ok=True)

# 站点图标：墨底 + 砖红折线，32×32 内联，省一个二进制文件
FAVICON = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">'
    '<rect width="32" height="32" rx="7" fill="#0F2A3D"/>'
    '<path d="M5 22.5 L10.8 16.2 L15.8 19.4 L21.4 10.4 L27 13.6" fill="none" '
    'stroke="#E4735A" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>'
    '</svg>'
)

ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"
CLIMATE_URL = "https://climate-api.open-meteo.com/v1/climate"
BASELINE_START, BASELINE_END = 1991, 2020      # 气候常年值基准期
DAILY_VARS = ["temperature_2m_max", "temperature_2m_min", "temperature_2m_mean", "precipitation_sum"]
TIMEZONE = "Asia/Shanghai"
ARCHIVE_LAG_DAYS = 5
CACHE_TTL = 6 * 3600
CHUNK = 8
SENTINELS = {-9999.0, -999.0, 9999.0}
UA = "weather-dashboard/1.0 (course project)"

# 预置城市：按气候区分组，页面左侧直接用这份
PRESETS = [
    # 华北
    {"name": "北京", "group": "华北", "group_en": "North", "en": "Beijing", "lat": 39.9042, "lon": 116.4074},
    {"name": "天津", "group": "华北", "group_en": "North", "en": "Tianjin", "lat": 39.3434, "lon": 117.3616},
    {"name": "石家庄", "group": "华北", "group_en": "North", "en": "Shijiazhuang", "lat": 38.0428, "lon": 114.5149},
    {"name": "太原", "group": "华北", "group_en": "North", "en": "Taiyuan", "lat": 37.8706, "lon": 112.5489},
    {"name": "呼和浩特", "group": "华北", "group_en": "North", "en": "Hohhot", "lat": 40.8424, "lon": 111.7490},
    # 东北
    {"name": "沈阳", "group": "东北", "group_en": "Northeast", "en": "Shenyang", "lat": 41.8057, "lon": 123.4315},
    {"name": "长春", "group": "东北", "group_en": "Northeast", "en": "Changchun", "lat": 43.8171, "lon": 125.3235},
    {"name": "哈尔滨", "group": "东北", "group_en": "Northeast", "en": "Harbin", "lat": 45.8038, "lon": 126.5350},
    # 华东
    {"name": "上海", "group": "华东", "group_en": "East", "en": "Shanghai", "lat": 31.2304, "lon": 121.4737},
    {"name": "南京", "group": "华东", "group_en": "East", "en": "Nanjing", "lat": 32.0603, "lon": 118.7969},
    {"name": "杭州", "group": "华东", "group_en": "East", "en": "Hangzhou", "lat": 30.2741, "lon": 120.1551},
    {"name": "合肥", "group": "华东", "group_en": "East", "en": "Hefei", "lat": 31.8206, "lon": 117.2272},
    {"name": "福州", "group": "华东", "group_en": "East", "en": "Fuzhou", "lat": 26.0745, "lon": 119.2965},
    {"name": "南昌", "group": "华东", "group_en": "East", "en": "Nanchang", "lat": 28.6820, "lon": 115.8579},
    {"name": "济南", "group": "华东", "group_en": "East", "en": "Jinan", "lat": 36.6512, "lon": 117.1201},
    {"name": "台北", "group": "华东", "group_en": "East", "en": "Taipei", "lat": 25.0330, "lon": 121.5654},
    # 华中
    {"name": "郑州", "group": "华中", "group_en": "Central", "en": "Zhengzhou", "lat": 34.7466, "lon": 113.6254},
    {"name": "武汉", "group": "华中", "group_en": "Central", "en": "Wuhan", "lat": 30.5928, "lon": 114.3055},
    {"name": "长沙", "group": "华中", "group_en": "Central", "en": "Changsha", "lat": 28.2282, "lon": 112.9388},
    # 华南
    {"name": "广州", "group": "华南", "group_en": "South", "en": "Guangzhou", "lat": 23.1291, "lon": 113.2644},
    {"name": "深圳", "group": "华南", "group_en": "South", "en": "Shenzhen", "lat": 22.5431, "lon": 114.0579},
    {"name": "汕头", "group": "华南", "group_en": "South", "en": "Shantou", "lat": 23.3540, "lon": 116.6819},
    {"name": "南宁", "group": "华南", "group_en": "South", "en": "Nanning", "lat": 22.8170, "lon": 108.3665},
    {"name": "海口", "group": "华南", "group_en": "South", "en": "Haikou", "lat": 20.0440, "lon": 110.1999},
    {"name": "香港", "group": "华南", "group_en": "South", "en": "Hong Kong", "lat": 22.3193, "lon": 114.1694},
    {"name": "澳门", "group": "华南", "group_en": "South", "en": "Macao", "lat": 22.1987, "lon": 113.5439},
    # 西南
    {"name": "重庆", "group": "西南", "group_en": "Southwest", "en": "Chongqing", "lat": 29.5630, "lon": 106.5516},
    {"name": "成都", "group": "西南", "group_en": "Southwest", "en": "Chengdu", "lat": 30.5728, "lon": 104.0668},
    {"name": "贵阳", "group": "西南", "group_en": "Southwest", "en": "Guiyang", "lat": 26.6470, "lon": 106.6302},
    {"name": "昆明", "group": "西南", "group_en": "Southwest", "en": "Kunming", "lat": 25.0389, "lon": 102.7183},
    {"name": "拉萨", "group": "西南", "group_en": "Southwest", "en": "Lhasa", "lat": 29.6520, "lon": 91.1721},
    # 西北
    {"name": "西安", "group": "西北", "group_en": "Northwest", "en": "Xi\'an", "lat": 34.3416, "lon": 108.9398},
    {"name": "兰州", "group": "西北", "group_en": "Northwest", "en": "Lanzhou", "lat": 36.0611, "lon": 103.8343},
    {"name": "西宁", "group": "西北", "group_en": "Northwest", "en": "Xining", "lat": 36.6171, "lon": 101.7782},
    {"name": "银川", "group": "西北", "group_en": "Northwest", "en": "Yinchuan", "lat": 38.4872, "lon": 106.2309},
    {"name": "乌鲁木齐", "group": "西北", "group_en": "Northwest", "en": "Ürümqi", "lat": 43.8256, "lon": 87.6168},
]


# ---------------------------------------------------------------- HTTP 工具
def http_get_json(url: str, timeout: int = 30, retries: int = 3) -> tuple[dict, dict]:
    """GET 一个 JSON，带退避重试。返回 (解析结果, 取证信息)。"""
    last = None
    for attempt in range(1, retries + 1):
        t0 = time.perf_counter()
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                body = resp.read()
                elapsed = (time.perf_counter() - t0) * 1000
                if resp.status == 429 or resp.status >= 500:
                    raise urllib.error.HTTPError(url, resp.status, "retryable", resp.headers, None)
                return json.loads(body.decode("utf-8")), {
                    "url": resp.geturl(),
                    "status": resp.status,
                    "bytes": len(body),
                    "sha256": hashlib.sha256(body).hexdigest(),
                    "elapsed_ms": round(elapsed, 1),
                    "body": body,
                }
        except urllib.error.HTTPError as e:
            last = e
            retry_after = None
            try:
                retry_after = float(e.headers.get("Retry-After", ""))
            except (TypeError, ValueError):
                pass
            time.sleep(retry_after if retry_after else 2 ** attempt)
        except (urllib.error.URLError, TimeoutError, socket.timeout, json.JSONDecodeError) as e:
            last = e
            time.sleep(2 ** attempt)
    raise RuntimeError(f"请求失败（重试 {retries} 次）：{last}")


# ---------------------------------------------------------------- 抓取
def _date_window(days: int, end: str | None) -> tuple[date, date]:
    end_d = date.fromisoformat(end) if end else date.today() - timedelta(days=ARCHIVE_LAG_DAYS)
    return end_d - timedelta(days=days - 1), end_d


def fetch_cities(cities: list[dict], days: int, end: str | None) -> dict:
    """按批抓取多个城市，返回合并后的原始块 + 取证信息。"""
    start, end_d = _date_window(days, end)
    blocks: list[dict] = []
    proofs: list[dict] = []
    for i in range(0, len(cities), CHUNK):
        batch = cities[i:i + CHUNK]
        params = {
            "latitude": ",".join(f"{c['lat']:.4f}" for c in batch),
            "longitude": ",".join(f"{c['lon']:.4f}" for c in batch),
            "start_date": start.isoformat(),
            "end_date": end_d.isoformat(),
            "daily": ",".join(DAILY_VARS),
            "timezone": TIMEZONE,
        }
        url = ARCHIVE_URL + "?" + urllib.parse.urlencode(params)
        payload, proof = http_get_json(url)
        got = payload if isinstance(payload, list) else [payload]
        if len(got) != len(batch):
            raise RuntimeError(f"返回块数 {len(got)} 与请求城市数 {len(batch)} 不一致")
        blocks.extend(got)
        proofs.append(proof)
    return {"blocks": blocks, "proofs": proofs, "start": start, "end": end_d}


# ---------------------------------------------------------------- 清洗（纯 Python）
def _num(v) -> float | None:
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(f) or f in SENTINELS:
        return None
    return f


def _median(xs: list[float]) -> float:
    if not xs:
        return 8.0
    s = sorted(xs)
    n = len(s)
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2


def clean_city(city: dict, block: dict, start: date, end: date) -> dict:
    daily = block["daily"]
    raw_dates = daily["time"]
    idx = {d: i for i, d in enumerate(raw_dates)}
    days = [start + timedelta(days=k) for k in range((end - start).days + 1)]

    cols = {k: [] for k in ("tmax", "tmin", "tmean", "prcp")}
    src = {"tmax": "temperature_2m_max", "tmin": "temperature_2m_min",
           "tmean": "temperature_2m_mean", "prcp": "precipitation_sum"}
    filled = 0
    gaps = 0
    for d in days:
        i = idx.get(d.isoformat())
        if i is None:
            gaps += 1
            for k in cols:
                cols[k].append(None)
            continue
        for k, var in src.items():
            cols[k].append(_num(daily[var][i]))

    # 城市典型日较差（用于单侧缺测重建）
    dtrs = [a - b for a, b in zip(cols["tmax"], cols["tmin"]) if a is not None and b is not None]
    dtr_ref = _median(dtrs)

    for i in range(len(days)):
        tmax, tmin, tmean, prcp = cols["tmax"][i], cols["tmin"][i], cols["tmean"][i], cols["prcp"][i]
        # L1 tmean 由 (max+min)/2
        if tmean is None and tmax is not None and tmin is not None:
            tmean = (tmax + tmin) / 2
            filled += 1
        # L2 单侧缺 → 用 tmean 反推
        if tmax is None and tmean is not None:
            tmax = 2 * tmean - tmin if tmin is not None else tmean + dtr_ref / 2
            filled += 1
        if tmin is None and tmean is not None:
            tmin = 2 * tmean - tmax if tmax is not None else tmean - dtr_ref / 2
            filled += 1
        # L4 降水缺 → 0
        if prcp is None:
            prcp = 0.0
            filled += 1
        cols["tmax"][i], cols["tmin"][i], cols["tmean"][i], cols["prcp"][i] = tmax, tmin, tmean, prcp

    # L3 线性插值兜底
    for k in ("tmax", "tmin", "tmean"):
        arr = cols[k]
        known = [i for i, v in enumerate(arr) if v is not None]
        if not known:
            continue
        for i in range(len(arr)):
            if arr[i] is not None:
                continue
            prev = max((j for j in known if j < i), default=None)
            nxt = min((j for j in known if j > i), default=None)
            if prev is not None and nxt is not None:
                w = (i - prev) / (nxt - prev)
                arr[i] = arr[prev] + (arr[nxt] - arr[prev]) * w
            elif prev is not None:
                arr[i] = arr[prev]
            elif nxt is not None:
                arr[i] = arr[nxt]
            filled += 1

    series = {
        "date": [d.isoformat() for d in days],
        "tmax": [None if v is None else round(v, 1) for v in cols["tmax"]],
        "tmin": [None if v is None else round(v, 1) for v in cols["tmin"]],
        "tmean": [None if v is None else round(v, 1) for v in cols["tmean"]],
        "prcp": [None if v is None else round(v, 1) for v in cols["prcp"]],
    }
    series["dtr"] = [
        None if (a is None or b is None) else round(a - b, 1)
        for a, b in zip(series["tmax"], series["tmin"])
    ]
    return {
        "name": city["name"],
        "group": city.get("group", "自选"),
        "lat": city["lat"],
        "lon": city["lon"],
        "grid": [block["latitude"], block["longitude"]],
        "elevation": block["elevation"],
        "series": series,
        "filled_cells": filled,
        "missing_days_from_api": gaps,
    }


# ---------------------------------------------------------------- 统计（纯 Python）
def _stats(city: dict) -> dict:
    s = city["series"]
    tmean = [v for v in s["tmean"] if v is not None]
    tmax = [v for v in s["tmax"] if v is not None]
    tmin = [v for v in s["tmin"] if v is not None]
    dtr = [v for v in s["dtr"] if v is not None]
    prcp = [v for v in s["prcp"] if v is not None]
    n = len(tmean)
    xs = list(range(n))
    mx, my = sum(xs) / n, sum(tmean) / n
    den = sum((x - mx) ** 2 for x in xs)
    slope = sum((x - mx) * (y - my) for x, y in zip(xs, tmean)) / den if den else 0.0
    pred = [slope * x + (my - slope * mx) for x in xs]
    ss_res = sum((y - p) ** 2 for y, p in zip(tmean, pred))
    ss_tot = sum((y - my) ** 2 for y in tmean)
    r2 = 1 - ss_res / ss_tot if ss_tot else 0.0
    i_max = max(range(len(s["tmax"])), key=lambda i: s["tmax"][i] if s["tmax"][i] is not None else -999)
    i_min = min(range(len(s["tmin"])), key=lambda i: s["tmin"][i] if s["tmin"][i] is not None else 999)
    head = tmean[:10]
    tail = tmean[-10:]
    return {
        "days": n,
        "tmean_mean": round(sum(tmean) / n, 1),
        "tmean_std": round(math.sqrt(sum((v - my) ** 2 for v in tmean) / (n - 1)), 1) if n > 1 else 0.0,
        "tmax_mean": round(sum(tmax) / len(tmax), 1),
        "tmin_mean": round(sum(tmin) / len(tmin), 1),
        "tmax_peak": s["tmax"][i_max],
        "tmax_peak_date": s["date"][i_max],
        "tmin_low": s["tmin"][i_min],
        "tmin_low_date": s["date"][i_min],
        "dtr_mean": round(sum(dtr) / len(dtr), 1),
        "trend_per10d": round(slope * 10, 2),
        "trend_r2": round(r2, 2),
        "first10": round(sum(head) / len(head), 1),
        "last10": round(sum(tail) / len(tail), 1),
        "prcp_total": round(sum(prcp), 1),
        "rain_days": sum(1 for v in prcp if v is not None and v > 0.1),
    }


def _corr(a: list[float], b: list[float]) -> float:
    pairs = [(x, y) for x, y in zip(a, b) if x is not None and y is not None]
    if len(pairs) < 3:
        return 0.0
    n = len(pairs)
    mx = sum(p[0] for p in pairs) / n
    my = sum(p[1] for p in pairs) / n
    sx = math.sqrt(sum((p[0] - mx) ** 2 for p in pairs))
    sy = math.sqrt(sum((p[1] - my) ** 2 for p in pairs))
    if not sx or not sy:
        return 0.0
    return sum((p[0] - mx) * (p[1] - my) for p in pairs) / (sx * sy)


# ---------------------------------------------------------------- 常年值（1991–2020 同期）
BASELINE_CACHE: dict[str, float] = {}
BASELINE_TTL = 30 * 24 * 3600


def _baseline_one(city: dict, start_md: tuple[int, int], days: int) -> float | None:
    """取 1991–2020 每年同一日历窗口的日均温，求 30 年均值。"""
    params = {
        "latitude": f"{city['lat']:.4f}", "longitude": f"{city['lon']:.4f}",
        "start_date": f"{BASELINE_START}-01-01", "end_date": f"{BASELINE_END}-12-31",
        "daily": "temperature_2m_mean", "timezone": TIMEZONE,
    }
    data, _ = http_get_json(CLIMATE_URL + "?" + urllib.parse.urlencode(params), timeout=90)
    daily = data.get("daily") or {}
    times, vals = daily.get("time") or [], daily.get("temperature_2m_mean") or []
    if not times:
        return None
    m0, d0 = start_md
    picked = []
    for t, v in zip(times, vals):
        if v is None:
            continue
        y, m, d = int(t[:4]), int(t[5:7]), int(t[8:10])
        # 用「年内序日」判断是否落在窗口内，避免跨年逻辑
        try:
            this = date(y, m, d)
            base = date(y, m0, d0)
        except ValueError:
            continue
        delta = (this - base).days
        if 0 <= delta < days:
            picked.append(float(v))
    if not picked:
        return None
    return round(sum(picked) / len(picked), 2)


def baseline(cities: list[dict], start: date, days: int) -> dict:
    """并发取多城常年值；结果缓存 30 天。"""
    from concurrent.futures import ThreadPoolExecutor

    key_base = f"{start.month:02d}-{start.day:02d}:{days}"
    todo, out = [], {}
    for c in cities:
        k = f"{c['name']}|{key_base}"
        hit = BASELINE_CACHE.get(k)
        if hit and time.time() - hit["ts"] < BASELINE_TTL:
            out[c["name"]] = hit["v"]
        else:
            todo.append(c)

    if todo:
        with ThreadPoolExecutor(max_workers=min(5, len(todo))) as ex:
            futs = {ex.submit(_baseline_one, c, (start.month, start.day), days): c for c in todo}
            for fut, c in futs.items():
                try:
                    v = fut.result()
                except Exception:              # noqa: BLE001
                    v = None
                out[c["name"]] = v
                BASELINE_CACHE[f"{c['name']}|{key_base}"] = {"v": v, "ts": time.time()}

    return {"baseline_period": f"{BASELINE_START}-{BASELINE_END}", "values": out}


# ---------------------------------------------------------------- 缓存与总装
def _cache_key(cities: list[dict], days: int, end: str | None) -> str:
    canon = json.dumps(
        {"c": sorted([c["name"] for c in cities]), "d": days, "e": end}, ensure_ascii=False, sort_keys=True
    )
    return hashlib.sha1(canon.encode("utf-8")).hexdigest()[:16]


def build_payload(cities: list[dict], days: int, end: str | None, force: bool = False) -> dict:
    key = _cache_key(cities, days, end)
    cache_file = CACHE / f"weather_{key}.json"
    if cache_file.exists() and not force:
        try:
            cached = json.loads(cache_file.read_text(encoding="utf-8"))
            age = time.time() - cached["meta"]["cached_ts"]
            if age < CACHE_TTL:
                cached["meta"]["cache_hit"] = True
                cached["meta"]["cache_age_s"] = int(age)
                return cached
        except (json.JSONDecodeError, KeyError):
            pass

    t0 = time.perf_counter()
    got = fetch_cities(cities, days, end)
    start, end_d = got["start"], got["end"]

    cleaned = [clean_city(c, b, start, end_d) for c, b in zip(cities, got["blocks"])]
    for c in cleaned:
        c["summary"] = _stats(c)

    names = [c["name"] for c in cleaned]
    matrix = [[round(_corr(a["series"]["tmean"], b["series"]["tmean"]), 2) for b in cleaned] for a in cleaned]

    # 原始报文落盘（按字节），保证可回溯
    raw_files = []
    for p in got["proofs"]:
        fn = RAW / f"{p['sha256'][:16]}.json"
        fn.write_bytes(p["body"])
        raw_files.append(fn.name)

    payload = {
        "meta": {
            "source": "Open-Meteo Historical Weather API (ERA5)",
            "model": "default(blend)",
            "timezone": TIMEZONE,
            "start": start.isoformat(),
            "end": end_d.isoformat(),
            "days": days,
            "vars": DAILY_VARS,
            "fetched_at": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
            "cached_ts": time.time(),
            "cache_hit": False,
            "elapsed_ms": round((time.perf_counter() - t0) * 1000, 1),
            "request_url": got["proofs"][0]["url"] if got["proofs"] else "",
            "sha256": got["proofs"][0]["sha256"] if got["proofs"] else "",
            "raw_files": raw_files,
            "quality": {
                "filled_cells": sum(c["filled_cells"] for c in cleaned),
                "missing_days": sum(c["missing_days_from_api"] for c in cleaned),
            },
            "attribution": "数据 © Open-Meteo.com / ERA5 (CC BY 4.0)",
        },
        "cities": cleaned,
        "corr": {"names": names, "matrix": matrix},
    }
    cache_file.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return payload


# ---------------------------------------------------------------- 城市搜索
#
# 主用 Open-Meteo Geocoding（只认拼音/英文）；
# 中文名它一条都返回不了，此时退回本地 370 城坐标表（DataV 生成，离线）。

CITIES_FILE = ASSETS / "vendor" / "cn_cities.json"
CITY_INDEX: list[dict] = []


def _load_cities() -> None:
    global CITY_INDEX
    try:
        CITY_INDEX = json.loads(CITIES_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        CITY_INDEX = []


def _local_cities(q: str, limit: int = 8) -> list[dict]:
    key = q.strip()
    if not key:
        return []
    k = key
    for suf in ("特别行政区", "自治州", "地区", "盟", "市"):
        if k.endswith(suf):
            k = k[: -len(suf)]
            break
    exact, prefix, contains = [], [], []
    for c in CITY_INDEX:
        short = c.get("short") or c["name"]
        if short == k:
            exact.append(c)
        elif short.startswith(k):
            prefix.append(c)
        elif k in short:
            contains.append(c)
    prefix.sort(key=lambda c: len(c["short"]))
    return [{"name": c["name"], "admin": c["province"], "lat": c["lat"],
             "lon": c["lon"], "source": "local"} for c in (exact + prefix + contains)[:limit]]


def geocode(q: str, lang: str = "zh") -> dict:
    """地名 → 坐标。

    中文界面：含中文先查本地 370 城表（地级市优先，离线、毫秒级），拼音/英文走 Open-Meteo；
    英文界面：直接走 Open-Meteo 的 language=en，拿回官方英文名；失败再退回本地表。
    """
    if lang != "en" and any("一" <= ch <= "鿿" for ch in q):
        local = _local_cities(q)
        if local:
            return {"results": local, "source": "local"}

    params = {"name": q, "count": 8, "language": "en" if lang == "en" else "zh", "format": "json"}
    url = GEOCODE_URL + "?" + urllib.parse.urlencode(params)
    out = []
    try:
        data, _ = http_get_json(url)
        for r in data.get("results", []) or []:
            country = r.get("country_code", "")
            if country and country != "CN":
                continue
            out.append({
                "name": r.get("name"),
                "admin": r.get("admin1") or "",
                "lat": r.get("latitude"),
                "lon": r.get("longitude"),
                "population": r.get("population") or 0,
            })
    except RuntimeError:
        out = []

    if not out:                                   # 中文名 / 接口无结果 → 本地表
        local = _local_cities(q)
        if local:
            return {"results": local, "source": "local"}

    return {"results": out[:8]}


# ---------------------------------------------------------------- HTTP 服务
class Handler(BaseHTTPRequestHandler):
    server_version = "WeatherDash/1.0"

    def log_message(self, fmt, *args):  # 安静一点，只打错误
        if str(args[1] if len(args) > 1 else "").startswith(("4", "5")):
            sys.stderr.write("[http] " + fmt % args + "\n")

    def _send(self, code: int, body: bytes, ctype: str, extra: dict | None = None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        # 开发期：代码与数据一律不缓存，避免改完样式刷新还是旧的；字体/图片可缓存
        no_cache = ctype.startswith(("application/json", "text/html", "text/css", "application/javascript", "text/javascript"))
        self.send_header("Cache-Control", "no-store" if no_cache else "max-age=86400")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, obj, code: int = 200):
        self._send(code, json.dumps(obj, ensure_ascii=False).encode("utf-8"),
                   "application/json; charset=utf-8")

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(parsed.path)
        qs = urllib.parse.parse_qs(parsed.query)

        try:
            if path in ("/", "/index.html"):
                return self._file(ROOT / "index.html", "text/html; charset=utf-8")
            # 浏览器必问，不处理会在日志里刷 404；SVG 一张，省一个二进制文件
            if path in ("/favicon.svg", "/favicon.ico"):
                return self._send(200, FAVICON.encode("utf-8"), "image/svg+xml")
            if path.startswith("/assets/"):
                target = (ROOT / path.lstrip("/")).resolve()
                if not str(target).startswith(str(ASSETS.resolve())):
                    return self._json({"error": "forbidden"}, 403)
                return self._file(target)
            if path == "/api/health":
                return self._json({"ok": True, "presets": PRESETS})
            if path == "/api/geocode":
                q = (qs.get("q") or [""])[0].strip()
                lang = (qs.get("lang") or ["zh"])[0]
                if not q:
                    return self._json({"results": []})
                return self._json(geocode(q, "en" if lang == "en" else "zh"))
            if path == "/api/baseline":
                raw = (qs.get("cities") or [""])[0]
                names = [n.strip() for n in re.split(r"[,，]", raw) if n.strip()][:5]
                days = int((qs.get("days") or ["30"])[0])
                if days not in (7, 30, 90):
                    days = 30
                lookup = {p["name"]: p for p in PRESETS}
                cities = []
                for n in names:
                    if n in lookup:
                        cities.append(lookup[n])
                    else:
                        hit = geocode(n)["results"]
                        if hit:
                            cities.append({"name": n, "group": "自选", "lat": hit[0]["lat"], "lon": hit[0]["lon"]})
                if not cities:
                    return self._json({"error": "没有可识别的城市"}, 400)
                start, _ = _date_window(days, (qs.get("end") or [None])[0])
                t0 = time.perf_counter()
                payload = baseline(cities, start, days)
                payload["elapsed_ms"] = round((time.perf_counter() - t0) * 1000, 1)
                return self._json(payload)
            if path == "/api/weather":
                raw = (qs.get("cities") or [""])[0]
                names = [n.strip() for n in re.split(r"[,，]", raw) if n.strip()]
                if not names:
                    return self._json({"error": "没有选择城市"}, 400)
                days = int((qs.get("days") or ["30"])[0])
                if days not in (7, 30, 90):
                    days = 30
                end = (qs.get("end") or [None])[0]
                force = (qs.get("force") or ["0"])[0] in ("1", "true")

                lookup = {p["name"]: p for p in PRESETS}
                cities = []
                for n in names:
                    if n in lookup:
                        cities.append(lookup[n])
                    else:
                        hit = geocode(n)["results"]
                        if not hit:
                            return self._json({"error": f"找不到城市：{n}"}, 404)
                        cities.append({"name": n, "group": "自选", "lat": hit[0]["lat"], "lon": hit[0]["lon"]})
                if len(cities) > 5:
                    return self._json({"error": "一次最多对比 5 个城市"}, 400)

                t0 = time.perf_counter()
                payload = build_payload(cities, days, end, force=force)
                payload["meta"]["server_ms"] = round((time.perf_counter() - t0) * 1000, 1)
                return self._json(payload)
            return self._json({"error": "not found"}, 404)
        except RuntimeError as e:
            return self._json({"error": str(e)}, 502)
        except Exception as e:  # 兜底，别让页面只看到断连
            import traceback
            traceback.print_exc()
            return self._json({"error": f"服务端异常：{type(e).__name__}: {e}"}, 500)

    # HEAD 走同一套路由：_send 里已按 self.command 跳过正文，
    # 不补这个方法 BaseHTTPRequestHandler 会直接回 501。
    do_HEAD = do_GET

    def _file(self, p: Path, ctype: str | None = None):
        if not p.exists() or not p.is_file():
            return self._json({"error": "not found"}, 404)
        ctype = ctype or mimetypes.guess_type(str(p))[0] or "application/octet-stream"
        if p.suffix in (".js", ".css", ".json"):
            ctype += "; charset=utf-8"
        self._send(200, p.read_bytes(), ctype)


def main():
    _load_cities()
    ap = argparse.ArgumentParser()
    # 云端部署：平台注入 PORT，并要求服务绑 0.0.0.0；本地跑仍默认 127.0.0.1:8848
    env_port = os.environ.get("PORT")
    ap.add_argument("--host", default=os.environ.get("HOST") or ("0.0.0.0" if env_port else "127.0.0.1"))
    ap.add_argument("--port", type=int, default=int(env_port) if env_port else 8848)
    args = ap.parse_args()
    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"天气数据看板已启动 → http://{args.host}:{args.port}", flush=True)
    print(f"预置城市 {len(PRESETS)} 个；本地城市表 {len(CITY_INDEX)} 条（中文搜索兜底）", flush=True)
    print("Ctrl+C 停止")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")
        srv.server_close()


if __name__ == "__main__":
    main()
