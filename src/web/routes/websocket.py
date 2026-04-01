import asyncio
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..task_manager import task_manager

logger = logging.getLogger(__name__)
router = APIRouter()


@router.websocket("/ws/task/{task_id}")
async def task_websocket(websocket: WebSocket, task_id: str):
    await websocket.accept()
    task_manager.register_websocket(task_id, websocket)

    try:
        status = task_manager.get_status(task_id)
        if status:
            await websocket.send_json({"type": "status", "task_id": task_id, **status})

        for log in task_manager.get_logs(task_id):
            await websocket.send_json({"type": "log", "task_id": task_id, "message": log})

        while True:
            try:
                data = await asyncio.wait_for(websocket.receive_json(), timeout=30.0)
                if data.get("type") == "ping":
                    await websocket.send_json({"type": "pong"})
            except asyncio.TimeoutError:
                await websocket.send_json({"type": "ping"})
    except WebSocketDisconnect:
        logger.info("websocket disconnected: %s", task_id)
    finally:
        task_manager.unregister_websocket(task_id, websocket)
