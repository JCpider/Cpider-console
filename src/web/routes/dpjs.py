from datetime import datetime
from uuid import uuid4

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field

from ...core.dpjs_service import get_default_dpjs_config, normalize_dpjs_config, start_dpjs_task
from ...database.crud import (
    create_task,
    get_site_by_code,
    get_task_by_uuid,
    get_task_logs,
    list_tasks_by_type,
    upsert_site_by_code,
)
from ...database.session import get_db
from ..task_manager import task_manager

router = APIRouter()
DPJS_SITE_CODE = "dpjs_spider"


class RequestTemplatePayload(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    url: str
    method: str = "GET"
    params: dict | list | str | int | float | bool | None = None
    data: dict | list | str | int | float | bool | None = None
    json_body: dict | list | str | int | float | bool | None = Field(default=None, alias="json")


class ResultParserPayload(BaseModel):
    enabled: bool = False
    code: str = ""


class DpjsConfigPayload(BaseModel):
    page_url: str
    user_data_path: str | None = None
    proxy_url: str | None = None
    headless: bool = False
    multi_request: bool = False
    sleep_seconds: float = 0
    loop_enabled: bool = False
    loop_variable_name: str = "page"
    loop_start: float = 1
    loop_count: int = 1
    loop_step: float = 1
    request_template: RequestTemplatePayload
    request_variables: list[dict] = []
    result_parser: ResultParserPayload = ResultParserPayload()


@router.get("")
async def read_dpjs_state():
    with get_db() as db:
        site = get_site_by_code(db, DPJS_SITE_CODE)
        config = normalize_dpjs_config(site.settings_json if site and site.settings_json else get_default_dpjs_config())
        tasks = [task.to_dict() for task in list_tasks_by_type(db, "dpjs", limit=10)]
        return {
            "config": config,
            "site": site.to_dict() if site else None,
            "recent_tasks": tasks,
            "server_time": datetime.now().isoformat(),
        }


@router.put("/config")
async def save_dpjs_config(payload: DpjsConfigPayload):
    config = normalize_dpjs_config(payload.model_dump(by_alias=True))
    with get_db() as db:
        site = upsert_site_by_code(
            db,
            code=DPJS_SITE_CODE,
            name="DPJS-Spider",
            base_url=config["page_url"],
            parser_type="dpjs",
            settings_json=config,
            enabled=True,
        )
        return {"ok": True, "config": config, "site": site.to_dict()}


@router.post("/run")
async def run_dpjs(payload: DpjsConfigPayload):
    config = normalize_dpjs_config(payload.model_dump(by_alias=True))
    task_uuid = f"dpjs-{uuid4().hex[:12]}"
    with get_db() as db:
        site = upsert_site_by_code(
            db,
            code=DPJS_SITE_CODE,
            name="DPJS-Spider",
            base_url=config["page_url"],
            parser_type="dpjs",
            settings_json=config,
            enabled=True,
        )
        task = create_task(
            db,
            task_uuid=task_uuid,
            task_type="dpjs",
            site_id=site.id,
            target_url=config["request_template"]["url"],
            status="pending",
        )
    start_dpjs_task(task_uuid, config, site_id=task.site_id)
    return {"ok": True, "task_id": task_uuid, "task": task.to_dict()}


@router.post("/tasks/{task_uuid}/cancel")
async def cancel_dpjs_task(task_uuid: str):
    with get_db() as db:
        task = get_task_by_uuid(db, task_uuid)
        if task is None:
            return {"ok": False, "message": "task not found"}
        if task.task_type != "dpjs":
            return {"ok": False, "message": "task is not dpjs"}
        if task.status in {"completed", "failed", "cancelled"}:
            return {"ok": False, "message": f"task already {task.status}", "status": task.status}

    task_manager.request_cancel(task_uuid)
    task_manager.add_log(task_uuid, "[dpjs] cancel requested by user")
    task_manager.update_status(task_uuid, "running", message="DPJS task stopping", task_type="dpjs")
    return {"ok": True, "task_id": task_uuid, "status": "cancelling"}


@router.get("/tasks")
async def read_dpjs_tasks(limit: int = 10):
    with get_db() as db:
        tasks = [task.to_dict() for task in list_tasks_by_type(db, "dpjs", limit=limit)]
        return {"tasks": tasks}


@router.get("/tasks/{task_uuid}")
async def read_dpjs_task(task_uuid: str):
    with get_db() as db:
        task = get_task_by_uuid(db, task_uuid)
        if task is None:
            return {"ok": False, "task": None, "logs": []}
        logs = [log.to_dict() for log in get_task_logs(db, task_uuid)]
        return {"ok": True, "task": task.to_dict(), "logs": logs}
