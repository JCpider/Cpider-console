import logging
import os
import sys
from pathlib import Path

import uvicorn

if getattr(sys, "frozen", False):
    project_root = Path(sys.executable).parent
    _src_root = Path(sys._MEIPASS)
else:
    project_root = Path(__file__).parent
    _src_root = project_root

sys.path.insert(0, str(_src_root))

from src.config.settings import get_settings, load_settings, update_settings
from src.core.utils import setup_logging
from src.database import initialize_database


def _load_dotenv() -> None:
    env_path = project_root / ".env"
    if not env_path.exists():
        return
    with open(env_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value


def setup_application():
    _load_dotenv()

    data_dir = project_root / "data"
    logs_dir = project_root / "logs"
    data_dir.mkdir(exist_ok=True)
    logs_dir.mkdir(exist_ok=True)

    os.environ.setdefault("APP_DATA_DIR", str(data_dir))
    os.environ.setdefault("APP_LOGS_DIR", str(logs_dir))

    initialize_database(os.environ.get("APP_DATABASE_URL"))
    settings = load_settings(force_reload=True)
    log_file = str(logs_dir / Path(settings.log_file).name)
    setup_logging(settings.log_level, log_file)

    logger = logging.getLogger(__name__)
    logger.info("cpider initialized")
    logger.info("data dir: %s", data_dir)
    logger.info("logs dir: %s", logs_dir)
    return settings


def start_webui():
    settings = setup_application()

    logger = logging.getLogger(__name__)
    logger.info("web ui listening on http://%s:%s", settings.webui_host, settings.webui_port)

    uvicorn.run(
        "src.web.app:app",
        host=settings.webui_host,
        port=settings.webui_port,
        reload=settings.debug,
        log_level="info" if settings.debug else "warning",
        access_log=settings.debug,
    )


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Spider Console Web UI")
    parser.add_argument("--host", help="Web UI host")
    parser.add_argument("--port", type=int, help="Web UI port")
    parser.add_argument("--debug", action="store_true", help="Enable debug mode")
    parser.add_argument("--log-level", help="Log level")
    parser.add_argument("--access-password", help="Web UI access password")
    args = parser.parse_args()

    _load_dotenv()

    data_dir = project_root / "data"
    logs_dir = project_root / "logs"
    data_dir.mkdir(exist_ok=True)
    logs_dir.mkdir(exist_ok=True)

    os.environ.setdefault("APP_DATA_DIR", str(data_dir))
    os.environ.setdefault("APP_LOGS_DIR", str(logs_dir))
    initialize_database(os.environ.get("APP_DATABASE_URL"))

    updates = {}
    host = args.host or os.environ.get("WEBUI_HOST")
    if host:
        updates["webui_host"] = host

    port = args.port or os.environ.get("WEBUI_PORT")
    if port:
        updates["webui_port"] = int(port)

    debug = args.debug or os.environ.get("DEBUG", "").lower() in {"1", "true", "yes"}
    if debug:
        updates["debug"] = debug

    log_level = args.log_level or os.environ.get("LOG_LEVEL")
    if log_level:
        updates["log_level"] = log_level

    access_password = args.access_password or os.environ.get("WEBUI_ACCESS_PASSWORD")
    if access_password:
        updates["webui_access_password"] = access_password

    if updates:
        update_settings(**updates)

    start_webui()


if __name__ == "__main__":
    main()
