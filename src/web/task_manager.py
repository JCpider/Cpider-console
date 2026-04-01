import asyncio
import threading
from collections import defaultdict
from datetime import datetime
from typing import Dict, List, Optional

from ..database.crud import (
    append_task_log,
    create_task,
    get_task_by_uuid,
    get_task_logs,
    update_task_status,
)
from ..database.session import get_db


class TaskManager:
    def __init__(self):
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._logs: Dict[str, List[str]] = defaultdict(list)
        self._status: Dict[str, dict] = {}
        self._connections: Dict[str, List] = defaultdict(list)
        self._cancel_requested: set[str] = set()
        self._lock = threading.Lock()

    def set_loop(self, loop: asyncio.AbstractEventLoop):
        self._loop = loop

    def register_websocket(self, task_id: str, websocket):
        with self._lock:
            if websocket not in self._connections[task_id]:
                self._connections[task_id].append(websocket)

    def unregister_websocket(self, task_id: str, websocket):
        with self._lock:
            if websocket in self._connections.get(task_id, []):
                self._connections[task_id].remove(websocket)

    def request_cancel(self, task_id: str) -> bool:
        with self._lock:
            self._cancel_requested.add(task_id)
        return True

    def is_cancel_requested(self, task_id: str) -> bool:
        with self._lock:
            return task_id in self._cancel_requested

    def clear_cancel_request(self, task_id: str) -> None:
        with self._lock:
            self._cancel_requested.discard(task_id)

    def add_log(self, task_id: str, message: str, level: str = "info"):
        self._logs[task_id].append(message)
        with get_db() as db:
            if get_task_by_uuid(db, task_id) is None:
                create_task(db, task_uuid=task_id)
            append_task_log(db, task_id, message=message, level=level)
        if self._loop and self._loop.is_running():
            asyncio.run_coroutine_threadsafe(self._broadcast_log(task_id, message, level), self._loop)

    async def _broadcast_log(self, task_id: str, message: str, level: str = "info"):
        for ws in list(self._connections.get(task_id, [])):
            await ws.send_json(
                {
                    "type": "log",
                    "task_id": task_id,
                    "message": message,
                    "level": level,
                    "timestamp": datetime.utcnow().isoformat(),
                }
            )

    def update_status(self, task_id: str, status: str, **kwargs):
        payload = {"status": status, **kwargs}
        self._status[task_id] = payload
        if status in {"completed", "failed", "cancelled"}:
            self.clear_cancel_request(task_id)
        with get_db() as db:
            task = get_task_by_uuid(db, task_id)
            if task is None:
                create_task(
                    db,
                    task_uuid=task_id,
                    task_type=kwargs.get("task_type", "debug"),
                    target_url=kwargs.get("target_url"),
                    status=status,
                )
            update_task_status(db, task_id, status, **kwargs)
        if self._loop and self._loop.is_running():
            asyncio.run_coroutine_threadsafe(self._broadcast_status(task_id), self._loop)

    async def _broadcast_status(self, task_id: str):
        payload = {"type": "status", "task_id": task_id, **(self.get_status(task_id) or {})}
        for ws in list(self._connections.get(task_id, [])):
            await ws.send_json(payload)

    def get_status(self, task_id: str) -> Optional[dict]:
        status = self._status.get(task_id)
        if status is not None:
            return status
        with get_db() as db:
            task = get_task_by_uuid(db, task_id)
            if task is None:
                return None
            return {
                "status": task.status,
                "task_type": task.task_type,
                "site_id": task.site_id,
                "target_url": task.target_url,
                "error_message": task.error_message,
                "started_at": task.started_at.isoformat() if task.started_at else None,
                "completed_at": task.completed_at.isoformat() if task.completed_at else None,
            }

    def get_logs(self, task_id: str) -> List[str]:
        cached = self._logs.get(task_id)
        if cached:
            return list(cached)
        with get_db() as db:
            return [log.message for log in get_task_logs(db, task_id)]

    def task_count(self) -> int:
        return len(self._status)

    def active_tasks(self) -> list[dict]:
        return [{"task_id": task_id, **status} for task_id, status in self._status.items()]


task_manager = TaskManager()
