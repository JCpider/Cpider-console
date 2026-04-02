from __future__ import annotations

import contextlib
import importlib.util
import json
import re
import threading
import time
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from threading import Thread
from typing import Any, Dict, Protocol
from urllib.parse import parse_qs, urlparse

from ..web.task_manager import task_manager

_PROJECT_ROOT = Path(__file__).resolve().parents[2]
_DPJS_ROOT = _PROJECT_ROOT / "dpjs"
_STANDALONE_MODULE_PATH = _DPJS_ROOT / "standalone_dpjs_downloader.py"
_DEFAULT_USER_DATA_PATH = _DPJS_ROOT / "google_user_data"
_DEFAULT_VIDEO_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/135.0.0.0 Safari/537.36"
)

_module_lock = threading.Lock()
_standalone_module = None


class VideoTaskCancelled(Exception):
    pass


DEFAULT_VIDEO_CONFIG: Dict[str, Any] = {
    "platform": "generic",
    "display_name": "通用站点",
    "engine": "dpjs",
    "page_url_template": "",
    "download": {
        "mode": "metadata",
        "save_dir": "data/video-downloads",
        "max_count": 20,
        "quality": "source",
        "concurrency": 2,
    },
    "request": {
        "proxy_url": None,
        "headless": True,
        "extra_headers": {"Referer": "", "Cookie": ""},
        "timeout": 30,
        "user_data_path": str(_DEFAULT_USER_DATA_PATH),
    },
    "parser": {
        "enabled": False,
        "code": "def parse(context):\n    # context: VideoParseContext\n    return {\"items\": context.raw_items}\n",
        "entry": "parse",
    },
    "adapter": {
        "type": "generic",
        "options": {},
    },
    "notes": "",
}


def get_default_video_config() -> Dict[str, Any]:
    return {
        "platform": DEFAULT_VIDEO_CONFIG["platform"],
        "display_name": DEFAULT_VIDEO_CONFIG["display_name"],
        "engine": DEFAULT_VIDEO_CONFIG["engine"],
        "page_url_template": DEFAULT_VIDEO_CONFIG["page_url_template"],
        "download": dict(DEFAULT_VIDEO_CONFIG["download"]),
        "request": {
            "proxy_url": DEFAULT_VIDEO_CONFIG["request"]["proxy_url"],
            "headless": DEFAULT_VIDEO_CONFIG["request"]["headless"],
            "extra_headers": dict(DEFAULT_VIDEO_CONFIG["request"]["extra_headers"]),
            "timeout": DEFAULT_VIDEO_CONFIG["request"]["timeout"],
            "user_data_path": DEFAULT_VIDEO_CONFIG["request"]["user_data_path"],
        },
        "parser": {
            "enabled": DEFAULT_VIDEO_CONFIG["parser"]["enabled"],
            "code": DEFAULT_VIDEO_CONFIG["parser"]["code"],
            "entry": DEFAULT_VIDEO_CONFIG["parser"]["entry"],
        },
        "adapter": {
            "type": DEFAULT_VIDEO_CONFIG["adapter"]["type"],
            "options": dict(DEFAULT_VIDEO_CONFIG["adapter"]["options"]),
        },
        "notes": DEFAULT_VIDEO_CONFIG["notes"],
    }


def _as_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except Exception:
        return default


def _as_float(value: Any, default: float) -> float:
    try:
        return float(value)
    except Exception:
        return default


def normalize_video_config(config: Dict[str, Any] | None) -> Dict[str, Any]:
    base = get_default_video_config()
    incoming = config or {}

    base["platform"] = str(incoming.get("platform") or base["platform"])
    base["display_name"] = str(incoming.get("display_name") or base["display_name"])
    base["engine"] = str(incoming.get("engine") or base["engine"])
    base["page_url_template"] = str(incoming.get("page_url_template") or base["page_url_template"])

    download = dict(base["download"])
    incoming_download = incoming.get("download") or {}
    download["mode"] = str(incoming_download.get("mode") or download["mode"])
    download["save_dir"] = str(incoming_download.get("save_dir") or download["save_dir"])
    download["max_count"] = max(1, _as_int(incoming_download.get("max_count", download["max_count"]), download["max_count"]))
    download["quality"] = str(incoming_download.get("quality") or download["quality"])
    download["concurrency"] = max(1, _as_int(incoming_download.get("concurrency", download["concurrency"]), download["concurrency"]))
    base["download"] = download

    request = dict(base["request"])
    incoming_request = incoming.get("request") or {}
    request["proxy_url"] = incoming_request.get("proxy_url") or request["proxy_url"]
    request["headless"] = bool(incoming_request.get("headless", request["headless"]))
    extra_headers = incoming_request.get("extra_headers") or request["extra_headers"]
    if not isinstance(extra_headers, dict):
        extra_headers = request["extra_headers"]
    request["extra_headers"] = extra_headers
    request["timeout"] = max(1, _as_int(incoming_request.get("timeout", request["timeout"]), request["timeout"]))
    request["user_data_path"] = str(incoming_request.get("user_data_path") or request["user_data_path"])
    base["request"] = request

    parser = dict(base["parser"])
    incoming_parser = incoming.get("parser") or {}
    parser["enabled"] = bool(incoming_parser.get("enabled", parser["enabled"]))
    code = incoming_parser.get("code")
    if isinstance(code, str) and code.strip():
        parser["code"] = code
    parser["entry"] = str(incoming_parser.get("entry") or parser["entry"])
    base["parser"] = parser

    adapter = dict(base["adapter"])
    incoming_adapter = incoming.get("adapter") or {}
    adapter["type"] = str(incoming_adapter.get("type") or adapter["type"])
    options = incoming_adapter.get("options")
    adapter["options"] = options if isinstance(options, dict) else adapter["options"]
    base["adapter"] = adapter

    base["notes"] = str(incoming.get("notes") or base["notes"])

    runtime = incoming.get("runtime") or {}
    runtime_page_url = runtime.get("page_url") or incoming.get("page_url") or base.get("page_url_template")
    base["runtime"] = {
        "page_url": str(runtime_page_url or ""),
        "requested_at": runtime.get("requested_at") or datetime.utcnow().isoformat(),
    }

    return base


@dataclass
class VideoParseContext:
    platform: str
    page_url: str
    raw_items: list[Dict[str, Any]]
    raw_payload: Dict[str, Any]


class VideoAdapter(Protocol):
    type: str

    def run(self, task_id: str, config: Dict[str, Any], site_id: int | None = None) -> Dict[str, Any]:
        ...


VIDEO_ADAPTERS: Dict[str, VideoAdapter] = {}


def register_video_adapter(adapter: VideoAdapter) -> None:
    VIDEO_ADAPTERS[adapter.type] = adapter


def get_video_adapter(adapter_type: str) -> VideoAdapter:
    if adapter_type in VIDEO_ADAPTERS:
        return VIDEO_ADAPTERS[adapter_type]
    raise ValueError(f"unknown video adapter type: {adapter_type}")


def _load_standalone_module():
    global _standalone_module
    if _standalone_module is not None:
        return _standalone_module
    with _module_lock:
        if _standalone_module is not None:
            return _standalone_module
        if not _STANDALONE_MODULE_PATH.exists():
            raise FileNotFoundError(f"standalone dpjs module not found: {_STANDALONE_MODULE_PATH}")
        spec = importlib.util.spec_from_file_location("standalone_dpjs_downloader", _STANDALONE_MODULE_PATH)
        if spec is None or spec.loader is None:
            raise RuntimeError("failed to load standalone dpjs module")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        _standalone_module = module
        return module


def _wait_page_ready(tab) -> None:
    tab.wait.load_start()
    with contextlib.suppress(Exception):
        tab.wait.doc_loaded()
    for _ in range(50):
        state = None
        with contextlib.suppress(Exception):
            state = tab.run_js("return document.readyState")
        if state == "complete":
            return
        time.sleep(0.2)


def _safe_filename(value: str, fallback: str = "video") -> str:
    cleaned = re.sub(r"[\\/:*?\"<>|]+", "_", (value or "").strip())
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" .")
    return cleaned or fallback


def _resolve_save_path(save_dir: str, file_name: str) -> Path:
    path = Path(save_dir or DEFAULT_VIDEO_CONFIG["download"]["save_dir"])
    if not path.is_absolute():
        path = _PROJECT_ROOT / path
    path.mkdir(parents=True, exist_ok=True)
    return path / file_name


def _video_proxies(config: Dict[str, Any]) -> Dict[str, str] | None:
    request = config.get("request") or {}
    proxy_url = request.get("proxy_url")
    if not proxy_url:
        return None
    return {"http": str(proxy_url), "https": str(proxy_url)}


def _build_video_request_headers(config: Dict[str, Any], page_url: str) -> dict[str, str]:
    request = config.get("request") or {}
    extra_headers = deepcopy(request.get("extra_headers") or {})
    headers = {str(key): str(value) for key, value in extra_headers.items() if value not in (None, "")}
    headers.setdefault("Referer", page_url)
    headers.setdefault("User-Agent", _DEFAULT_VIDEO_USER_AGENT)
    return headers


def _build_video_downloader(config: Dict[str, Any], host: str):
    module = _load_standalone_module()
    downloader_cls = module.StandaloneDpJsDownloader
    request_config = config.get("request") or {}
    return downloader_cls(
        user_data_path=str(request_config.get("user_data_path") or _DEFAULT_VIDEO_USER_DATA_PATH),
        headless=bool(request_config.get("headless", True)),
        host=host,
        default_timeout=max(1, _as_int(request_config.get("timeout", 30), 30)),
    )


def _extract_json_from_html(html: str, marker: str) -> dict[str, Any] | None:
    patterns = [
        rf"{re.escape(marker)}\s*=\s*(\{{.*?\}})\s*;</script>",
        rf"{re.escape(marker)}\s*=\s*(\{{.*?\}})\s*;",
    ]
    for pattern in patterns:
        match = re.search(pattern, html, re.DOTALL)
        if not match:
            continue
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            continue
    return None


def _extract_bvid(page_url: str, html: str) -> str | None:
    parsed = urlparse(page_url)
    query_bvid = parse_qs(parsed.query).get("bvid")
    if query_bvid:
        return query_bvid[0]
    match = re.search(r"/(BV[0-9A-Za-z]+)/?", parsed.path)
    if match:
        return match.group(1)
    match = re.search(r'"bvid"\s*:\s*"(BV[0-9A-Za-z]+)"', html)
    return match.group(1) if match else None


def _pick_bilibili_quality_label(play_data: dict[str, Any], requested_quality: str) -> str:
    requested = str(requested_quality or "source").lower()
    quality = play_data.get("quality") or play_data.get("qn")
    if requested != "source":
        return requested
    if quality:
        return str(quality)
    return "source"


def _resolve_bilibili_view_info(task_id: str, page_url: str, config: Dict[str, Any], downloader) -> dict[str, Any]:
    module = _load_standalone_module()
    request_cls = module.StandaloneRequest
    headers = _build_video_request_headers(config, page_url)
    cookies = headers.get("Cookie")
    if cookies:
        task_manager.add_log(task_id, "[video][bilibili] using provided Cookie header")
    else:
        task_manager.add_log(task_id, "[video][bilibili] running without Cookie, anonymous parsing may fail")
    response = downloader.fetch(
        request_cls(
            url=page_url,
            method="GET",
            headers=headers,
            cookies=cookies,
            proxies=_video_proxies(config),
            extra={"host": page_url, "on_load": _wait_page_ready, "auto_referer": True},
            timeout=(config.get("request") or {}).get("timeout"),
        )
    )
    html = response.text
    initial_state = _extract_json_from_html(html, "window.__INITIAL_STATE__") or {}
    playinfo = _extract_json_from_html(html, "window.__playinfo__") or {}
    bvid = _extract_bvid(page_url, html)
    video_data = initial_state.get("videoData") if isinstance(initial_state, dict) else {}
    cid = None
    if isinstance(video_data, dict):
        cid = video_data.get("cid")
        if cid is None:
            pages = video_data.get("pages") or []
            if isinstance(pages, list) and pages:
                first_page = pages[0] if isinstance(pages[0], dict) else {}
                cid = first_page.get("cid")
    owner = video_data.get("owner") if isinstance(video_data, dict) else {}
    return {
        "html": html,
        "page_response": {"status_code": response.status_code, "url": response.url},
        "initial_state": initial_state,
        "playinfo": playinfo,
        "bvid": bvid,
        "cid": cid,
        "title": (video_data.get("title") if isinstance(video_data, dict) else None) or _safe_filename(bvid or "bilibili-video"),
        "owner": owner.get("name") if isinstance(owner, dict) else None,
        "duration": video_data.get("duration") if isinstance(video_data, dict) else None,
    }


def _resolve_bilibili_play_info(task_id: str, page_url: str, config: Dict[str, Any], downloader, view_info: Dict[str, Any]) -> dict[str, Any]:
    playinfo = view_info.get("playinfo") if isinstance(view_info.get("playinfo"), dict) else {}
    play_data = playinfo.get("data") if isinstance(playinfo.get("data"), dict) else playinfo
    if isinstance(play_data, dict) and play_data.get("durl"):
        task_manager.add_log(task_id, "[video][bilibili] using page embedded playinfo")
        return play_data

    bvid = view_info.get("bvid")
    cid = view_info.get("cid")
    if not bvid or not cid:
        raise ValueError("未能从页面中解析出 bvid/cid，可能需要 Cookie 或页面暂不受支持")

    task_manager.add_log(task_id, f"[video][bilibili] fallback to playurl api with bvid={bvid} cid={cid}")
    module = _load_standalone_module()
    request_cls = module.StandaloneRequest
    headers = _build_video_request_headers(config, page_url)
    cookies = headers.get("Cookie")
    request_quality = str((config.get("download") or {}).get("quality") or "source").lower()
    qn = "127" if request_quality == "source" else "80"
    api_url = f"https://api.bilibili.com/x/player/playurl?bvid={bvid}&cid={cid}&qn={qn}&fnval=0&fnver=0&fourk=1"
    response = downloader.fetch(
        request_cls(
            url=api_url,
            method="GET",
            headers=headers,
            cookies=cookies,
            proxies=_video_proxies(config),
            extra={"host": page_url, "auto_referer": True},
            timeout=(config.get("request") or {}).get("timeout"),
        )
    )
    payload = response.json()
    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, dict):
        raise ValueError("Bilibili playurl 接口返回异常")
    return data


def _download_video_file(task_id: str, config: Dict[str, Any], downloader, media: Dict[str, Any], page_url: str) -> Dict[str, Any]:
    _raise_if_cancel_requested(task_id, page_url)
    module = _load_standalone_module()
    request_cls = module.StandaloneRequest
    headers = _build_video_request_headers(config, page_url)
    cookies = headers.get("Cookie")
    response = downloader.fetch(
        request_cls(
            url=str(media.get("play_url") or ""),
            method="GET",
            headers=headers,
            cookies=cookies,
            proxies=_video_proxies(config),
            extra={"host": page_url, "auto_referer": True},
            timeout=(config.get("request") or {}).get("timeout"),
        )
    )
    _raise_if_cancel_requested(task_id, page_url)
    extension = ".mp4"
    content_type = str(response.headers.get("content-type") or "")
    if "flv" in content_type:
        extension = ".flv"
    target_name = media.get("file_name") or _safe_filename(str(media.get("title") or media.get("bvid") or "bilibili-video"))
    if not str(target_name).lower().endswith((".mp4", ".flv")):
        target_name = f"{target_name}{extension}"
    target_path = _resolve_save_path((config.get("download") or {}).get("save_dir") or "", str(target_name))
    target_path.write_bytes(response.content)
    task_manager.add_log(task_id, f"[video][bilibili] downloaded file: {target_path}")
    return {
        **media,
        "status": "downloaded",
        "file_path": str(target_path),
        "content_type": content_type,
        "size": len(response.content),
    }


class GenericVideoAdapter:
    type = "generic"

    def run(self, task_id: str, config: Dict[str, Any], site_id: int | None = None) -> Dict[str, Any]:
        task_manager.add_log(task_id, f"[video] generic adapter running for platform={config.get('platform')}")
        runtime = config.get("runtime") or {}
        page_url = str(runtime.get("page_url") or config.get("page_url_template") or "")

        raw_items: list[Dict[str, Any]] = [
            {
                "title": "示例视频 1",
                "status": "metadata-only",
                "page_url": page_url,
            }
        ]
        context = VideoParseContext(
            platform=str(config.get("platform") or "generic"),
            page_url=page_url,
            raw_items=raw_items,
            raw_payload={"items": raw_items},
        )

        parser = config.get("parser") or {}
        parsed_items = raw_items
        item_count = len(raw_items)
        error: str | None = None

        if parser.get("enabled"):
            try:
                parsed = _execute_video_parser(parser, context)
                parsed_items = parsed["items"]
                item_count = parsed["item_count"]
                error = parsed.get("error")
            except Exception as exc:  # noqa: BLE001
                error = str(exc)
                task_manager.add_log(task_id, f"[video][parse][error] {exc}", level="error")

        return {
            "platform": context.platform,
            "page_url": context.page_url,
            "download": config.get("download") or {},
            "request": config.get("request") or {},
            "parser": {
                "enabled": bool(parser.get("enabled")),
                "code": parser.get("code") or "",
                "entry": parser.get("entry") or "parse",
            },
            "item_count": item_count,
            "download_count": 0,
            "items": parsed_items,
            "errors": ([{"level": "error", "message": error}] if error else []),
            "raw": context.raw_payload,
        }


class BilibiliVideoAdapter:
    type = "bilibili"

    def run(self, task_id: str, config: Dict[str, Any], site_id: int | None = None) -> Dict[str, Any]:
        runtime = config.get("runtime") or {}
        page_url = str(runtime.get("page_url") or config.get("page_url_template") or "")
        parsed_url = urlparse(page_url)
        if "bilibili.com" not in parsed_url.netloc:
            raise ValueError("当前仅支持 bilibili 单视频页面 URL")

        task_manager.add_log(task_id, f"[video][bilibili] parsing page: {page_url}")
        downloader = _build_video_downloader(config, page_url)
        parser = config.get("parser") or {}
        errors: list[Dict[str, Any]] = []
        try:
            view_info = _resolve_bilibili_view_info(task_id, page_url, config, downloader)
            _raise_if_cancel_requested(task_id, page_url, site_id=site_id)
            play_data = _resolve_bilibili_play_info(task_id, page_url, config, downloader, view_info)
            _raise_if_cancel_requested(task_id, page_url, site_id=site_id)

            durl_items = play_data.get("durl") or []
            if not isinstance(durl_items, list) or not durl_items:
                if play_data.get("dash"):
                    raise ValueError("当前版本仅支持单文件直链下载，暂不支持 DASH 音视频分离流")
                raise ValueError("未解析到可下载的单文件直链，可能需要 Cookie 或当前页面暂不受支持")

            first_item = durl_items[0] if isinstance(durl_items[0], dict) else {}
            media = {
                "title": view_info.get("title") or "bilibili-video",
                "bvid": view_info.get("bvid"),
                "cid": view_info.get("cid"),
                "author": view_info.get("owner"),
                "duration": view_info.get("duration") or first_item.get("length"),
                "quality": _pick_bilibili_quality_label(play_data, (config.get("download") or {}).get("quality") or "source"),
                "play_url": first_item.get("url") or "",
                "backup_urls": first_item.get("backup_url") or [],
                "status": "metadata-only",
                "page_url": page_url,
                "file_path": None,
                "message": None,
                "file_name": _safe_filename(str(view_info.get("title") or view_info.get("bvid") or "bilibili-video")),
            }
            if not media["play_url"]:
                raise ValueError("播放信息中没有可用的下载地址")

            items = [media]
            download_count = 0
            if str((config.get("download") or {}).get("mode") or "metadata") == "file":
                task_manager.add_log(task_id, "[video][bilibili] downloading first direct media file")
                downloaded = _download_video_file(task_id, config, downloader, media, page_url)
                items = [downloaded]
                download_count = 1
            else:
                task_manager.add_log(task_id, "[video][bilibili] metadata-only mode enabled, skip file download")

            context = VideoParseContext(
                platform="bilibili",
                page_url=page_url,
                raw_items=items,
                raw_payload={
                    "view_info": {
                        "bvid": view_info.get("bvid"),
                        "cid": view_info.get("cid"),
                        "title": view_info.get("title"),
                        "owner": view_info.get("owner"),
                    },
                    "play_info": play_data,
                },
            )
            parsed_items = items
            item_count = len(items)
            if parser.get("enabled"):
                try:
                    parsed = _execute_video_parser(parser, context)
                    parsed_items = parsed["items"]
                    item_count = parsed["item_count"]
                except Exception as exc:  # noqa: BLE001
                    errors.append({"level": "error", "message": str(exc)})
                    task_manager.add_log(task_id, f"[video][parse][error] {exc}", level="error")

            return {
                "platform": "bilibili",
                "page_url": page_url,
                "download": config.get("download") or {},
                "request": config.get("request") or {},
                "parser": {
                    "enabled": bool(parser.get("enabled")),
                    "code": parser.get("code") or "",
                    "entry": parser.get("entry") or "parse",
                },
                "item_count": item_count,
                "download_count": download_count,
                "items": parsed_items,
                "videos": parsed_items,
                "errors": errors,
                "request_count": 2,
                "raw": context.raw_payload,
            }
        finally:
            with contextlib.suppress(Exception):
                downloader.close(clear_cache=False)


def _raise_if_cancel_requested(task_id: str, page_url: str, site_id: int | None = None) -> None:
    if not task_manager.is_cancel_requested(task_id):
        return
    task_manager.add_log(task_id, "[video] cancellation confirmed, stopping task")
    task_manager.update_status(
        task_id,
        "cancelled",
        message="Video task cancelled",
        task_type="video",
        site_id=site_id,
        target_url=page_url or None,
    )
    raise VideoTaskCancelled()


def _execute_video_parser(parser_config: Dict[str, Any], context: VideoParseContext) -> Dict[str, Any]:
    code = str(parser_config.get("code") or "").strip()
    if not code:
        raise ValueError("parser code is empty")

    entry_name = str(parser_config.get("entry") or "parse")
    safe_builtins: Dict[str, Any] = {
        "len": len,
        "range": range,
        "min": min,
        "max": max,
        "sum": sum,
        "enumerate": enumerate,
        "list": list,
        "dict": dict,
        "set": set,
        "sorted": sorted,
        "isinstance": isinstance,
        "getattr": getattr,
        "hasattr": hasattr,
        "abs": abs,
        "all": all,
        "any": any,
        "zip": zip,
    }

    namespace: Dict[str, Any] = {}
    exec(code, {"__builtins__": safe_builtins}, namespace)
    func = namespace.get(entry_name)
    if not callable(func):
        raise ValueError(f"parser code must define {entry_name}(context)")

    result = func(context)
    if isinstance(result, dict) and "items" in result:
        items = result.get("items")
    else:
        items = result
    if items is None:
        items_list: list[Any] = []
    elif isinstance(items, list):
        items_list = items
    else:
        items_list = [items]

    return {"ok": True, "item_count": len(items_list), "items": items_list, "error": None}


register_video_adapter(GenericVideoAdapter())
register_video_adapter(BilibiliVideoAdapter())


def run_video_task(task_id: str, config: Dict[str, Any], site_id: int | None = None) -> None:
    normalized = normalize_video_config(config)
    adapter_type = (normalized.get("adapter") or {}).get("type") or normalized.get("platform") or "generic"
    adapter = get_video_adapter(adapter_type)
    runtime = normalized.get("runtime") or {}
    page_url = str(runtime.get("page_url") or normalized.get("page_url_template") or "")

    try:
        task_manager.update_status(
            task_id,
            "running",
            message="Video task started",
            task_type="video",
            site_id=site_id,
            target_url=page_url or None,
        )
        _raise_if_cancel_requested(task_id, page_url, site_id=site_id)
        task_manager.add_log(task_id, f"[video] task started platform={normalized.get('platform')} adapter={adapter_type}")
        result_json = adapter.run(task_id, normalized, site_id)
        _raise_if_cancel_requested(task_id, page_url, site_id=site_id)
        task_manager.update_status(
            task_id,
            "completed",
            message="Video task completed",
            task_type="video",
            site_id=site_id,
            target_url=page_url or None,
            result_json=result_json,
        )
    except VideoTaskCancelled:
        return
    except Exception as exc:  # noqa: BLE001
        message = str(exc)
        if "Cookie" not in message and any(key in message for key in ["未能", "不支持", "下载", "播放"]):
            message = f"{message}；可先重试无 Cookie，若仍失败再补 Cookie"
        task_manager.add_log(task_id, f"[video][error] {message}", level="error")
        task_manager.update_status(
            task_id,
            "failed",
            message="Video task failed",
            task_type="video",
            site_id=site_id,
            target_url=page_url or None,
            error_message=message,
        )


def start_video_task(task_id: str, config: Dict[str, Any], site_id: int | None = None) -> Thread:
    thread = Thread(target=run_video_task, args=(task_id, config, site_id), daemon=True)
    thread.start()
    return thread
