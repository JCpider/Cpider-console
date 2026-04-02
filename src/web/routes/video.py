from datetime import datetime
from uuid import uuid4

from fastapi import APIRouter
from pydantic import BaseModel

from ...core.video_service import get_default_video_config, normalize_video_config, start_video_task
from ...database.crud import (
    create_task,
    get_sites,
    get_task_by_uuid,
    get_task_logs,
    list_tasks_by_type,
    upsert_site_by_code,
)
from ...database.session import get_db
from ..task_manager import task_manager

router = APIRouter()
VIDEO_PARSER_TYPE = "video"
SUPPORTED_VIDEO_PLATFORMS = {"bilibili"}


class VideoConfigPayload(BaseModel):
    page_url: str
    platform: str = "generic"
    save_dir: str | None = None
    max_count: int | None = None
    quality: str | None = None
    proxy_url: str | None = None
    download_media: bool | None = None
    headless: bool | None = None
    extra_headers: dict | None = None
    notes: str | None = None
    parser_enabled: bool | None = None
    parser_code: str | None = None


class VideoRunPayload(VideoConfigPayload):
    pass


def _short_platform_name(platform: str) -> str:
    value = (platform or "").strip()
    if value.startswith("video:"):
        value = value.removeprefix("video:")
    return value or "generic"


def _site_code_from_platform(platform: str) -> str:
    short_name = _short_platform_name(platform)
    return f"video:{short_name}"


def _adapter_type_from_platform(short_name: str) -> str:
    return short_name if short_name in SUPPORTED_VIDEO_PLATFORMS else "generic"


def _build_site_config(payload: VideoConfigPayload) -> dict:
    base = get_default_video_config()
    short_name = _short_platform_name(payload.platform)
    base["platform"] = short_name
    base["display_name"] = f"视频平台 - {short_name}"
    base["adapter"] = {"type": _adapter_type_from_platform(short_name), "options": {}}
    base["download"]["mode"] = "file" if payload.download_media else "metadata"
    base["download"]["save_dir"] = payload.save_dir or base["download"]["save_dir"]
    if payload.max_count is not None:
        base["download"]["max_count"] = payload.max_count
    if payload.quality:
        base["download"]["quality"] = payload.quality
    base["request"]["proxy_url"] = payload.proxy_url or base["request"]["proxy_url"]
    if payload.headless is not None:
        base["request"]["headless"] = payload.headless
    if isinstance(payload.extra_headers, dict):
        base["request"]["extra_headers"] = payload.extra_headers
    base["notes"] = payload.notes or base["notes"]
    base.setdefault("runtime", {})["page_url"] = payload.page_url

    parser = base.get("parser") or {}
    if payload.parser_enabled is not None:
        parser["enabled"] = bool(payload.parser_enabled)
    if isinstance(payload.parser_code, str) and payload.parser_code.strip():
        parser["code"] = payload.parser_code
    base["parser"] = parser

    return base


@router.get("")
async def read_video_state():
    with get_db() as db:
        sites = [site.to_dict() for site in get_sites(db)]
        video_sites = [site for site in sites if site.get("parser_type") == VIDEO_PARSER_TYPE]
        site = video_sites[0] if video_sites else None
        config_source = site.get("settings_json") if site and site.get("settings_json") else get_default_video_config()
        config = normalize_video_config(config_source)
        tasks = [task.to_dict() for task in list_tasks_by_type(db, "video", limit=10)]
        return {
            "platforms": video_sites,
            "active_platform": site,
            "config": config,
            "recent_tasks": tasks,
            "supported_platforms": sorted(SUPPORTED_VIDEO_PLATFORMS),
            "server_time": datetime.now().isoformat(),
        }


@router.put("/config")
async def save_video_config(payload: VideoConfigPayload):
    short_name = _short_platform_name(payload.platform)
    site_code = _site_code_from_platform(payload.platform)
    config = normalize_video_config(_build_site_config(payload))
    with get_db() as db:
        site = upsert_site_by_code(
            db,
            code=site_code,
            name=f"视频平台 - {short_name}",
            base_url=config["runtime"]["page_url"] or config.get("page_url_template"),
            parser_type=VIDEO_PARSER_TYPE,
            settings_json=config,
            enabled=True,
        )
        return {"ok": True, "config": config, "site": site.to_dict()}


@router.post("/run")
async def run_video(payload: VideoRunPayload):
    short_name = _short_platform_name(payload.platform)
    site_code = _site_code_from_platform(payload.platform)
    config = normalize_video_config(_build_site_config(payload))
    task_uuid = f"video-{uuid4().hex[:12]}"
    with get_db() as db:
        site = upsert_site_by_code(
            db,
            code=site_code,
            name=f"视频平台 - {short_name}",
            base_url=config["runtime"]["page_url"] or config.get("page_url_template"),
            parser_type=VIDEO_PARSER_TYPE,
            settings_json=config,
            enabled=True,
        )
        task = create_task(
            db,
            task_uuid=task_uuid,
            task_type="video",
            site_id=site.id,
            target_url=config["runtime"]["page_url"] or config.get("page_url_template"),
            status="pending",
        )
    start_video_task(task_uuid, config, site_id=task.site_id)
    return {"ok": True, "task_id": task_uuid, "task": task.to_dict()}


@router.post("/tasks/{task_uuid}/cancel")
async def cancel_video_task(task_uuid: str):
    with get_db() as db:
        task = get_task_by_uuid(db, task_uuid)
        if task is None:
            return {"ok": False, "message": "task not found"}
        if task.task_type != "video":
            return {"ok": False, "message": "task is not video"}
        if task.status in {"completed", "failed", "cancelled"}:
            return {"ok": False, "message": f"task already {task.status}", "status": task.status}

    task_manager.request_cancel(task_uuid)
    task_manager.add_log(task_uuid, "[video] cancel requested by user")
    task_manager.update_status(task_uuid, "running", message="Video task stopping", task_type="video")
    return {"ok": True, "task_id": task_uuid, "status": "cancelling"}


@router.get("/tasks")
async def read_video_tasks(limit: int = 10):
    with get_db() as db:
        tasks = [task.to_dict() for task in list_tasks_by_type(db, "video", limit=limit)]
        return {"tasks": tasks}


@router.get("/tasks/{task_uuid}")
async def read_video_task(task_uuid: str):
    with get_db() as db:
        task = get_task_by_uuid(db, task_uuid)
        if task is None:
            return {"ok": False, "task": None, "logs": []}
        logs = [log.to_dict() for log in get_task_logs(db, task_uuid)]
        return {"ok": True, "task": task.to_dict(), "logs": logs}
