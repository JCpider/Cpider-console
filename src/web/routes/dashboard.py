from datetime import datetime

from fastapi import APIRouter

from ...config.settings import get_settings
from ...database.crud import count_running_tasks, count_sites, count_tasks, create_task, get_task_by_uuid, list_tasks
from ...database.session import get_db
from ..task_manager import task_manager

router = APIRouter()


@router.get("/summary")
async def get_dashboard_summary():
    settings = get_settings()
    with get_db() as db:
        recent_tasks = [task.to_dict() for task in list_tasks(db, limit=5)]
        return {
            "app_name": settings.app_name,
            "app_version": settings.app_version,
            "debug": settings.debug,
            "server_time": datetime.now().isoformat(),
            "task_count": count_tasks(db),
            "running_task_count": count_running_tasks(db),
            "enabled_site_count": count_sites(db, enabled_only=True),
            "recent_tasks": recent_tasks,
            "active_tasks": task_manager.active_tasks(),
        }


@router.post("/demo-task/{task_id}")
async def push_demo_task(task_id: str):
    with get_db() as db:
        if get_task_by_uuid(db, task_id) is None:
            create_task(db, task_uuid=task_id, task_type="debug", status="pending")
    task_manager.update_status(task_id, "running", message="Demo task started", task_type="debug")
    task_manager.add_log(task_id, f"[{datetime.now().strftime('%H:%M:%S')}] demo log for {task_id}")
    return {"ok": True, "task_id": task_id}
