from fastapi import APIRouter
from pydantic import BaseModel

from ...config.settings import get_settings, update_settings

router = APIRouter()


class SettingsPayload(BaseModel):
    app_name: str
    debug: bool
    webui_host: str
    webui_port: int
    log_level: str


@router.get("")
async def read_settings():
    settings = get_settings()
    return {
        "app_name": settings.app_name,
        "app_version": settings.app_version,
        "debug": settings.debug,
        "webui_host": settings.webui_host,
        "webui_port": settings.webui_port,
        "log_level": settings.log_level,
        "database_url": settings.database_url,
    }


@router.put("")
async def save_settings(payload: SettingsPayload):
    settings = update_settings(**payload.model_dump())
    return {
        "ok": True,
        "settings": {
            "app_name": settings.app_name,
            "app_version": settings.app_version,
            "debug": settings.debug,
            "webui_host": settings.webui_host,
            "webui_port": settings.webui_port,
            "log_level": settings.log_level,
            "database_url": settings.database_url,
        },
    }
