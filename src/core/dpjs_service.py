import contextlib
import importlib.util
import json
import threading
import time
from copy import deepcopy
from pathlib import Path
from string import Formatter
from typing import Any

from ..web.task_manager import task_manager

_PROJECT_ROOT = Path(__file__).resolve().parents[2]
_DPJS_ROOT = _PROJECT_ROOT / "dpjs"
_STANDALONE_MODULE_PATH = _DPJS_ROOT / "standalone_dpjs_downloader.py"
_DEFAULT_USER_DATA_PATH = _DPJS_ROOT / "google_user_data"

_module_lock = threading.Lock()
_standalone_module = None


DEFAULT_DPJS_CONFIG = {
    "page_url": "https://www.ozon.ru/category/smartfony-15502/?__rr=1&abt_att=1",
    "user_data_path": str(_DEFAULT_USER_DATA_PATH),
    "proxy_url": None,
    "headless": False,
    "multi_request": False,
    "sleep_seconds": 0,
    "loop_enabled": False,
    "loop_variable_name": "page",
    "loop_start": 1,
    "loop_count": 1,
    "loop_step": 1,
    "request_template": {
        "url": "https://www.ozon.ru/api/entrypoint-api.bx/page/json/v2?url=%2Fcategory%2Fsmartfony-15502%2F%3F__rr%3D1%26abt_att%3D1%26layout_page_index%3D{page}%26page%3D{page}%26paginator_token%3D3618992%26search_page_state%3DIAN7b9C377fDy63A6P-4ecJ1lqdO-aBwu7FhmIRshQlpEnmtgm_GsFFEHsbLk-epAQP4WTK8ROMXHwtuQHOBkykyq2L2RmLBgkfHHJ-n7s24SDBVu2iDHcH9ibO9AxEq2wPhdcQ%253D%26start_page_id%3D08e9905da8ef4e387b79ba8510047507",
        "method": "GET",
        "params": None,
        "data": None,
        "json": None,
    },
    "request_variables": [{"page": 2}],
    "parse": [
        {
            "engine": "json",
            "rules": {
                "data": {},
            },
            "mapping": {
                "": {"default": ""},
            },
        }
    ],
}


class SafeDict(dict):
    def __missing__(self, key):
        return "{" + key + "}"


class DpjsTaskCancelled(Exception):
    pass


class DpjsResponseAdapter:
    def __init__(self, result: dict[str, Any]):
        self.status_code = result.get("status_code")
        self.url = result.get("url")
        self.reason = result.get("reason")
        self.rt = result.get("rt")
        self._body_type = result.get("body_type")
        self._body = result.get("body")

    @property
    def text(self) -> str:
        if self._body_type == "text":
            return self._body if isinstance(self._body, str) else json.dumps(self._body, ensure_ascii=False, indent=2)
        return json.dumps(self._body, ensure_ascii=False, indent=2)

    def json(self) -> Any:
        if self._body_type == "json":
            return deepcopy(self._body)
        if isinstance(self._body, str):
            return json.loads(self._body)
        return deepcopy(self._body)


def get_default_dpjs_config() -> dict[str, Any]:
    return deepcopy(DEFAULT_DPJS_CONFIG)


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


def wait_page_ready(tab) -> None:
    tab.wait.load_start()
    with contextlib.suppress(Exception):
        tab.wait.doc_loaded()
    for _ in range(50):
        if tab.run_js("return document.readyState") == "complete":
            return
        time.sleep(0.2)


def format_value(value: Any, variables: dict[str, Any]) -> Any:
    if isinstance(value, str):
        return value.format_map(SafeDict(variables))
    if isinstance(value, dict):
        return {key: format_value(item, variables) for key, item in value.items()}
    if isinstance(value, list):
        return [format_value(item, variables) for item in value]
    return value


def has_placeholders(value: Any) -> bool:
    if isinstance(value, str):
        return any(field_name for _, field_name, _, _ in Formatter().parse(value) if field_name)
    if isinstance(value, dict):
        return any(has_placeholders(item) for item in value.values())
    if isinstance(value, list):
        return any(has_placeholders(item) for item in value)
    return False


def _normalize_parse_section(value: dict[str, Any] | None) -> dict[str, Any]:
    incoming = value or {}
    return {
        "engine": str(incoming.get("engine") or "json").lower(),
        "rules": deepcopy(incoming.get("rules") or {}),
        "mapping": deepcopy(incoming.get("mapping") or {}),
    }


def _normalize_parse_sections(value: Any, legacy_parser: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    if isinstance(value, list):
        return [_normalize_parse_section(item) for item in value if isinstance(item, dict)]
    if isinstance(value, dict):
        return [_normalize_parse_section(value)]
    if legacy_parser and legacy_parser.get("enabled"):
        return []
    return []


def normalize_dpjs_config(config: dict[str, Any] | None) -> dict[str, Any]:
    merged = get_default_dpjs_config()
    incoming = config or {}
    legacy_parser = incoming.get("result_parser") if isinstance(incoming.get("result_parser"), dict) else None
    merged.update({
        "page_url": incoming.get("page_url", merged["page_url"]),
        "user_data_path": incoming.get("user_data_path") or merged["user_data_path"],
        "proxy_url": incoming.get("proxy_url"),
        "headless": bool(incoming.get("headless", merged["headless"])),
        "multi_request": bool(incoming.get("multi_request", merged["multi_request"])),
        "sleep_seconds": max(0.0, float(incoming.get("sleep_seconds", merged["sleep_seconds"]) or 0)),
        "loop_enabled": bool(incoming.get("loop_enabled", merged["loop_enabled"])),
        "loop_variable_name": str(incoming.get("loop_variable_name") or merged["loop_variable_name"]),
        "loop_start": float(incoming.get("loop_start", merged["loop_start"]) or 0),
        "loop_count": max(1, int(incoming.get("loop_count", merged["loop_count"]) or 1)),
        "loop_step": float(incoming.get("loop_step", merged["loop_step"]) or 0),
        "parse": _normalize_parse_sections(incoming.get("parse"), legacy_parser=legacy_parser),
    })

    request_template = deepcopy(merged["request_template"])
    request_template.update(incoming.get("request_template") or {})
    request_template["method"] = str(request_template.get("method") or "GET").upper()
    merged["request_template"] = request_template

    request_variables = incoming.get("request_variables")
    if isinstance(request_variables, list):
        merged["request_variables"] = request_variables
    return merged


def _coerce_loop_value(value: float) -> int | float:
    return int(value) if float(value).is_integer() else value


def _build_loop_variables(config: dict[str, Any]) -> list[dict[str, Any]]:
    if not config.get("loop_enabled"):
        return []
    variable_name = str(config.get("loop_variable_name") or "").strip()
    if not variable_name:
        raise ValueError("loop_variable_name is required when loop is enabled")
    start = float(config.get("loop_start", 0) or 0)
    count = max(1, int(config.get("loop_count", 1) or 1))
    step = float(config.get("loop_step", 0) or 0)
    return [
        {variable_name: _coerce_loop_value(start + index * step)}
        for index in range(count)
    ]


def iter_request_variables(config: dict[str, Any]) -> list[dict[str, Any]]:
    request_template = config["request_template"]
    request_variables = config.get("request_variables") or []
    loop_variables = _build_loop_variables(config)
    if config.get("multi_request"):
        if loop_variables and request_variables:
            merged_variables = []
            for index, loop_variable in enumerate(loop_variables):
                base = request_variables[min(index, len(request_variables) - 1)] if request_variables else {}
                merged_variables.append({**base, **loop_variable})
            return merged_variables
        if loop_variables:
            return loop_variables
        return request_variables or [{}]
    if request_variables:
        return [request_variables[0]]
    if any(has_placeholders(value) for value in request_template.values()):
        if loop_variables:
            return [loop_variables[0]]
        raise ValueError("request_template contains placeholders but request_variables is empty")
    return [loop_variables[0]] if loop_variables else [{}]


def build_request_payload(config: dict[str, Any], variables: dict[str, Any]) -> dict[str, Any]:
    request_template = deepcopy(config["request_template"])
    return {
        "url": format_value(request_template["url"], variables),
        "method": format_value(request_template.get("method", "GET"), variables).upper(),
        "params": format_value(request_template.get("params"), variables),
        "data": format_value(request_template.get("data"), variables),
        "json": format_value(request_template.get("json"), variables),
    }


def _response_payload(response) -> dict[str, Any]:
    try:
        body = response.json()
        body_type = "json"
    except Exception:
        body = response.text
        body_type = "text"
    return {
        "status_code": response.status_code,
        "url": response.url,
        "reason": getattr(response, "reason", None),
        "rt": getattr(response, "rt", 0),
        "body_type": body_type,
        "body": body,
    }


def _coerce_items(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        return [value]
    return [value]


def _extract_json_path(value: Any, path: str) -> list[Any]:
    current_values = [value]
    for part in [item for item in str(path or "").split(".") if item]:
        next_values = []
        for current in current_values:
            if part == "$":
                if isinstance(current, list):
                    next_values.extend(current)
                continue
            if part == "$v":
                if isinstance(current, dict):
                    next_values.extend(current.values())
                elif isinstance(current, list):
                    next_values.extend(current)
                continue
            if isinstance(current, dict) and part in current:
                next_values.append(current.get(part))
        current_values = next_values
        if not current_values:
            break
    return current_values


def _apply_mapping(item: dict[str, Any], mapping: dict[str, Any], variables: dict[str, Any]) -> dict[str, Any]:
    mapped = dict(item)
    for field, config in (mapping or {}).items():
        if not isinstance(config, dict):
            continue
        if "default" in config:
            mapped[field] = format_value(config.get("default"), variables)
    return mapped


def _parse_json_section(body: Any, section: dict[str, Any], variables: dict[str, Any]) -> list[dict[str, Any]]:
    if section.get("engine") != "json":
        raise ValueError(f"unsupported parse engine: {section.get('engine')}")

    items = []
    rules = section.get("rules") or {}
    mapping = section.get("mapping") or {}
    if rules and all(isinstance(source_path, str) for source_path in rules.values()):
        parsed_item = {}
        for target_field, source_path in rules.items():
            values = _extract_json_path(body, str(source_path))
            parsed_item[target_field] = values[0] if values else None
        items.append(_apply_mapping(parsed_item, mapping, variables))
        return items

    for parent_path, nested_rules in rules.items():
        parent_values = _extract_json_path(body, parent_path)
        for parent_value in parent_values:
            if not isinstance(nested_rules, dict):
                continue
            if all(isinstance(source_path, str) for source_path in nested_rules.values()):
                parsed_item = {}
                for target_field, source_path in nested_rules.items():
                    values = _extract_json_path(parent_value, str(source_path))
                    parsed_item[target_field] = values[0] if values else None
                items.append(_apply_mapping(parsed_item, mapping, variables))
                continue
            for items_path, field_rules in nested_rules.items():
                rows = _extract_json_path(parent_value, items_path)
                for row in rows:
                    if not isinstance(row, dict):
                        continue
                    parsed_item = {}
                    for target_field, source_path in (field_rules or {}).items():
                        values = _extract_json_path(row, str(source_path))
                        parsed_item[target_field] = values[0] if values else None
                    items.append(_apply_mapping(parsed_item, mapping, variables))
    return items




def _execute_parse_sections(result: dict[str, Any], parse_sections: list[dict[str, Any]], variables: dict[str, Any]) -> dict[str, Any]:
    response = DpjsResponseAdapter(result)
    body = response.json()
    items = []
    section_results = []
    for index, section in enumerate(parse_sections, start=1):
        section_items = _parse_json_section(body, section, variables)
        items.extend(section_items)
        section_results.append({
            "index": index,
            "engine": section.get("engine"),
            "item_count": len(section_items),
            "items": section_items,
        })
    return {
        "ok": True,
        "item_count": len(items),
        "items": items,
        "sections": section_results,
        "error": None,
    }


def _raise_if_cancel_requested(task_id: str, request_template: dict[str, Any], site_id: int | None = None) -> None:
    if not task_manager.is_cancel_requested(task_id):
        return
    task_manager.add_log(task_id, "[dpjs] cancellation confirmed, stopping task")
    task_manager.update_status(
        task_id,
        "cancelled",
        message="DPJS task cancelled",
        task_type="dpjs",
        site_id=site_id,
        target_url=request_template["url"],
    )
    raise DpjsTaskCancelled()


def _sleep_with_cancel(task_id: str, seconds: float, request_template: dict[str, Any], site_id: int | None = None) -> None:
    remaining = max(0.0, float(seconds or 0))
    while remaining > 0:
        _raise_if_cancel_requested(task_id, request_template, site_id=site_id)
        interval = min(0.2, remaining)
        time.sleep(interval)
        remaining -= interval


def run_dpjs_task(task_id: str, config: dict[str, Any], site_id: int | None = None) -> None:
    module = _load_standalone_module()
    downloader_cls = module.StandaloneDpJsDownloader
    request_cls = module.StandaloneRequest
    normalized = normalize_dpjs_config(config)
    request_template = normalized["request_template"]
    parse_sections = normalized.get("parse") or []
    downloader = None
    try:
        task_manager.update_status(
            task_id,
            "running",
            message="DPJS task started",
            task_type="dpjs",
            site_id=site_id,
            target_url=request_template["url"],
        )
        _raise_if_cancel_requested(task_id, request_template, site_id=site_id)
        task_manager.add_log(task_id, f"[dpjs] bootstrap page: {normalized['page_url']}")
        downloader = downloader_cls(
            user_data_path=normalized["user_data_path"],
            headless=normalized["headless"],
            host=normalized["page_url"],
        )

        proxies = None
        if normalized.get("proxy_url"):
            proxies = {
                "http": normalized["proxy_url"],
                "https": normalized["proxy_url"],
            }
            task_manager.add_log(task_id, f"[dpjs] proxy enabled: {normalized['proxy_url']}")

        variables_list = iter_request_variables(normalized)
        sleep_seconds = normalized.get("sleep_seconds", 0)
        results = []
        parsed_items = {}
        total_item_count = 0
        total = len(variables_list)
        for index, variables in enumerate(variables_list, start=1):
            _raise_if_cancel_requested(task_id, request_template, site_id=site_id)
            request_payload = build_request_payload(normalized, variables)
            task_manager.add_log(
                task_id,
                f"[dpjs] request {index}/{total}: {request_payload['method']} {request_payload['url']}",
            )
            extra = {"host": normalized["page_url"]}
            if index == 1:
                extra["on_load"] = wait_page_ready
                task_manager.add_log(task_id, "[dpjs] waiting for PAGE_URL environment on first request")
            else:
                task_manager.add_log(task_id, "[dpjs] reusing existing browser environment for next request")
            response = downloader.fetch(
                request_cls(
                    url=request_payload["url"],
                    method=request_payload["method"],
                    params=request_payload["params"],
                    data=request_payload["data"],
                    json=request_payload["json"],
                    proxies=proxies,
                    extra=extra,
                )
            )
            _raise_if_cancel_requested(task_id, request_template, site_id=site_id)
            result = {
                "index": index,
                "variables": variables,
                **_response_payload(response),
            }
            if parse_sections:
                try:
                    parsed = _execute_parse_sections(result, parse_sections, variables)
                    parsed_items[str(index)] = parsed["items"]
                    total_item_count += parsed["item_count"]
                    result["parsed"] = parsed
                    task_manager.add_log(task_id, f"[dpjs][parse] request {index}/{total}: {parsed['item_count']} items parsed")
                except Exception as exc:
                    parsed_items[str(index)] = []
                    result["parsed"] = {"ok": False, "item_count": 0, "items": [], "sections": [], "error": str(exc)}
                    task_manager.add_log(task_id, f"[dpjs][parse][error] request {index}/{total}: {exc}", level="error")
            results.append(result)
            task_manager.add_log(
                task_id,
                f"[dpjs] response {index}/{total}: status={response.status_code} url={response.url}",
            )
            if index < total and sleep_seconds > 0:
                task_manager.add_log(task_id, f"[dpjs] sleep {sleep_seconds}s before next request")
                _sleep_with_cancel(task_id, sleep_seconds, request_template, site_id=site_id)

        result_json = {
            "page_url": normalized["page_url"],
            "multi_request": normalized["multi_request"],
            "sleep_seconds": sleep_seconds,
            "loop": {
                "enabled": normalized.get("loop_enabled", False),
                "variable_name": normalized.get("loop_variable_name"),
                "start": normalized.get("loop_start"),
                "count": normalized.get("loop_count"),
                "step": normalized.get("loop_step"),
            },
            "parse": parse_sections,
            "items": parsed_items,
            "item_count": total_item_count,
            "request_count": len(results),
            "results": results,
        }
        task_manager.update_status(
            task_id,
            "completed",
            message="DPJS task completed",
            task_type="dpjs",
            site_id=site_id,
            target_url=request_template["url"],
            result_json=result_json,
        )
    except DpjsTaskCancelled:
        pass
    except Exception as exc:
        task_manager.add_log(task_id, f"[dpjs][error] {exc}", level="error")
        task_manager.update_status(
            task_id,
            "failed",
            message="DPJS task failed",
            task_type="dpjs",
            site_id=site_id,
            target_url=request_template["url"],
            error_message=str(exc),
        )
    finally:
        if downloader is not None:
            with contextlib.suppress(Exception):
                downloader.close(clear_cache=False)


def start_dpjs_task(task_id: str, config: dict[str, Any], site_id: int | None = None) -> threading.Thread:
    thread = threading.Thread(target=run_dpjs_task, args=(task_id, config, site_id), daemon=True)
    thread.start()
    return thread
