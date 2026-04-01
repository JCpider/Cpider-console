from fastapi import APIRouter

from .dashboard import router as dashboard_router
from .dpjs import router as dpjs_router
from .settings import router as settings_router

api_router = APIRouter()
api_router.include_router(dashboard_router, prefix="/dashboard", tags=["dashboard"])
api_router.include_router(dpjs_router, prefix="/dpjs", tags=["dpjs"])
api_router.include_router(settings_router, prefix="/settings", tags=["settings"])
