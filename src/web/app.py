import asyncio
import hashlib
import hmac
import secrets
import sys
from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import FastAPI, Form, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from ..config.settings import get_settings
from .routes import api_router
from .routes.websocket import router as ws_router
from .task_manager import task_manager

if getattr(sys, "frozen", False):
    _RESOURCE_ROOT = Path(sys._MEIPASS)
else:
    _RESOURCE_ROOT = Path(__file__).parent.parent.parent

STATIC_DIR = _RESOURCE_ROOT / "static"
TEMPLATES_DIR = _RESOURCE_ROOT / "templates"


def _build_static_asset_version(static_dir: Path) -> str:
    latest_mtime = 0
    if static_dir.exists():
        for path in static_dir.rglob("*"):
            if path.is_file():
                latest_mtime = max(latest_mtime, int(path.stat().st_mtime))
    return str(latest_mtime or 1)


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        description="Spider Console Web UI",
        docs_url="/api/docs" if settings.debug else None,
        redoc_url="/api/redoc" if settings.debug else None,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    STATIC_DIR.mkdir(parents=True, exist_ok=True)
    TEMPLATES_DIR.mkdir(parents=True, exist_ok=True)

    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
    app.include_router(api_router, prefix="/api")
    app.include_router(ws_router, prefix="/api")

    templates = Jinja2Templates(directory=str(TEMPLATES_DIR))
    templates.env.globals["static_version"] = _build_static_asset_version(STATIC_DIR)

    def _render_template(request: Request, name: str, context: Optional[Dict[str, Any]] = None, status_code: int = 200) -> HTMLResponse:
        template_context = {"request": request, "settings": get_settings(), "active_page": None}
        if context:
            template_context.update(context)
        try:
            return templates.TemplateResponse(request=request, name=name, context=template_context, status_code=status_code)
        except TypeError:
            return templates.TemplateResponse(name, template_context, status_code=status_code)

    def _auth_token(password: str) -> str:
        secret = get_settings().webui_secret_key.get_secret_value().encode("utf-8")
        return hmac.new(secret, password.encode("utf-8"), hashlib.sha256).hexdigest()

    def _is_authenticated(request: Request) -> bool:
        cookie = request.cookies.get("spider_console_auth")
        expected = _auth_token(get_settings().webui_access_password.get_secret_value())
        return bool(cookie) and secrets.compare_digest(cookie, expected)

    def _redirect_to_login(request: Request) -> RedirectResponse:
        return RedirectResponse(url=f"/login?next={request.url.path}", status_code=302)

    @app.get("/login", response_class=HTMLResponse)
    async def login_page(request: Request, next: Optional[str] = "/"):
        return _render_template(request, "login.html", {"error": "", "next": next or "/"})

    @app.post("/login")
    async def login_submit(request: Request, password: str = Form(...), next: Optional[str] = "/"):
        expected = get_settings().webui_access_password.get_secret_value()
        if not secrets.compare_digest(password, expected):
            return _render_template(request, "login.html", {"error": "密码错误", "next": next or "/"}, status_code=401)
        response = RedirectResponse(url=next or "/", status_code=302)
        response.set_cookie("spider_console_auth", _auth_token(expected), httponly=True, samesite="lax")
        return response

    @app.get("/logout")
    async def logout(next: Optional[str] = "/login"):
        response = RedirectResponse(url=next or "/login", status_code=302)
        response.delete_cookie("spider_console_auth")
        return response

    @app.get("/", response_class=HTMLResponse)
    async def dashboard_page(request: Request):
        if not _is_authenticated(request):
            return _redirect_to_login(request)
        return _render_template(request, "dashboard.html", {"active_page": "dashboard"})

    @app.get("/settings", response_class=HTMLResponse)
    async def settings_page(request: Request):
        if not _is_authenticated(request):
            return _redirect_to_login(request)
        return _render_template(request, "settings.html", {"active_page": "settings"})

    @app.get("/dpjs-spider", response_class=HTMLResponse)
    async def dpjs_spider_page(request: Request):
        if not _is_authenticated(request):
            return _redirect_to_login(request)
        return _render_template(request, "dpjs_spider.html", {"active_page": "dpjs-spider"})

    @app.get("/video-spider", response_class=HTMLResponse)
    async def video_spider_page(request: Request):
        if not _is_authenticated(request):
            return _redirect_to_login(request)
        return _render_template(request, "video_spider.html", {"active_page": "video-spider"})

    @app.on_event("startup")
    async def startup_event():
        task_manager.set_loop(asyncio.get_event_loop())

    return app


app = create_app()
