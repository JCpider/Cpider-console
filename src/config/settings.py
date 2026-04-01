import os
from typing import Any

from pydantic import BaseModel, ConfigDict
from pydantic.types import SecretStr

from ..database.crud import list_settings, upsert_settings_batch
from ..database.session import get_db


class Settings(BaseModel):
    model_config = ConfigDict(validate_assignment=True)

    app_name: str = "Spider Console"
    app_version: str = "0.1.0"
    debug: bool = False
    webui_host: str = "127.0.0.1"
    webui_port: int = 8001
    webui_secret_key: SecretStr = SecretStr("change-this-secret-key")
    webui_access_password: SecretStr = SecretStr("admin123")
    log_level: str = "INFO"
    log_file: str = "app.log"
    database_url: str | None = None


SETTING_DEFINITIONS: list[dict[str, Any]] = [
    {
        "key": "app_name",
        "value": "Spider Console",
        "category": "general",
        "description": "Application display name",
    },
    {
        "key": "app_version",
        "value": "0.1.0",
        "category": "general",
        "description": "Application version",
    },
    {
        "key": "debug",
        "value": "false",
        "category": "general",
        "description": "Enable debug mode",
    },
    {
        "key": "webui_host",
        "value": "127.0.0.1",
        "category": "webui",
        "description": "Web UI host",
    },
    {
        "key": "webui_port",
        "value": "8001",
        "category": "webui",
        "description": "Web UI port",
    },
    {
        "key": "webui_secret_key",
        "value": "change-this-secret-key",
        "category": "security",
        "description": "Cookie signing secret",
    },
    {
        "key": "webui_access_password",
        "value": "admin123",
        "category": "security",
        "description": "Web UI access password",
    },
    {
        "key": "log_level",
        "value": "INFO",
        "category": "logging",
        "description": "Application log level",
    },
    {
        "key": "log_file",
        "value": "app.log",
        "category": "logging",
        "description": "Application log file name",
    },
    {
        "key": "database_url",
        "value": None,
        "category": "database",
        "description": "Database connection URL",
    },
]

BOOL_KEYS = {"debug"}
INT_KEYS = {"webui_port"}
SECRET_KEYS = {"webui_secret_key", "webui_access_password"}

_settings: Settings | None = None


def _default_values() -> dict[str, Any]:
    return {item["key"]: item.get("value") for item in SETTING_DEFINITIONS}


def _coerce_value(key: str, value: Any) -> Any:
    if key in SECRET_KEYS:
        return SecretStr(str(value or ""))
    if key in BOOL_KEYS:
        if isinstance(value, bool):
            return value
        return str(value).strip().lower() in {"1", "true", "yes", "on"}
    if key in INT_KEYS:
        return int(value)
    return value


def _serialize_value(key: str, value: Any) -> str | None:
    if value is None:
        return None
    if key in SECRET_KEYS:
        return value.get_secret_value() if isinstance(value, SecretStr) else str(value)
    if key in BOOL_KEYS:
        return "true" if bool(value) else "false"
    return str(value)


def _build_settings(values: dict[str, Any]) -> Settings:
    payload = {}
    for key, default_value in _default_values().items():
        payload[key] = _coerce_value(key, values.get(key, default_value))
    return Settings(**payload)


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        return _build_settings(_default_values())
    return _settings


def load_settings(force_reload: bool = False) -> Settings:
    global _settings
    if not force_reload and _settings is not None:
        return _settings
    values = _default_values()
    with get_db() as db:
        for row in list_settings(db):
            values[row.key] = row.value
    if not values.get("database_url"):
        values["database_url"] = os.environ.get("APP_DATABASE_URL")
    _settings = _build_settings(values)
    return _settings


def init_default_settings() -> None:
    with get_db() as db:
        existing_keys = {row.key for row in list_settings(db)}
        missing_items = [item for item in SETTING_DEFINITIONS if item["key"] not in existing_keys]
        if missing_items:
            upsert_settings_batch(db, missing_items)


def update_settings(**updates) -> Settings:
    global _settings
    if not updates:
        return get_settings()
    with get_db() as db:
        upsert_settings_batch(
            db,
            [
                {
                    "key": key,
                    "value": _serialize_value(key, value),
                    "category": next((item["category"] for item in SETTING_DEFINITIONS if item["key"] == key), "general"),
                    "description": next((item.get("description") for item in SETTING_DEFINITIONS if item["key"] == key), None),
                }
                for key, value in updates.items()
                if any(item["key"] == key for item in SETTING_DEFINITIONS)
            ],
        )
    _settings = load_settings(force_reload=True)
    return _settings
