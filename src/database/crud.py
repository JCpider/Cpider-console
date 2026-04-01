from datetime import datetime
from typing import Any, Optional

from sqlalchemy import desc, func
from sqlalchemy.orm import Session

from .models import Setting, SpiderSite, SpiderTask, TaskLog


def get_setting(db: Session, key: str) -> Optional[Setting]:
    return db.query(Setting).filter(Setting.key == key).first()


def list_settings(db: Session) -> list[Setting]:
    return db.query(Setting).order_by(Setting.key.asc()).all()


def set_setting(
    db: Session,
    key: str,
    value: Optional[str],
    category: str = "general",
    description: Optional[str] = None,
) -> Setting:
    row = get_setting(db, key)
    if row is None:
        row = Setting(key=key, value=value, category=category, description=description)
        db.add(row)
    else:
        row.value = value
        row.category = category
        if description is not None:
            row.description = description
    db.commit()
    db.refresh(row)
    return row


def upsert_settings_batch(db: Session, items: list[dict[str, Any]]) -> None:
    for item in items:
        set_setting(
            db,
            key=item["key"],
            value=item.get("value"),
            category=item.get("category", "general"),
            description=item.get("description"),
        )


def create_site(
    db: Session,
    name: str,
    code: str,
    base_url: Optional[str] = None,
    enabled: bool = True,
    parser_type: Optional[str] = None,
    settings_json: Optional[dict[str, Any]] = None,
) -> SpiderSite:
    site = SpiderSite(
        name=name,
        code=code,
        base_url=base_url,
        enabled=enabled,
        parser_type=parser_type,
        settings_json=settings_json or {},
    )
    db.add(site)
    db.commit()
    db.refresh(site)
    return site


def get_sites(db: Session, enabled: Optional[bool] = None) -> list[SpiderSite]:
    query = db.query(SpiderSite)
    if enabled is not None:
        query = query.filter(SpiderSite.enabled == enabled)
    return query.order_by(SpiderSite.created_at.desc()).all()


def get_site_by_id(db: Session, site_id: int) -> Optional[SpiderSite]:
    return db.query(SpiderSite).filter(SpiderSite.id == site_id).first()


def get_site_by_code(db: Session, code: str) -> Optional[SpiderSite]:
    return db.query(SpiderSite).filter(SpiderSite.code == code).first()


def update_site(db: Session, site_id: int, **kwargs) -> Optional[SpiderSite]:
    site = get_site_by_id(db, site_id)
    if site is None:
        return None
    for key, value in kwargs.items():
        if hasattr(site, key) and value is not None:
            setattr(site, key, value)
    db.commit()
    db.refresh(site)
    return site


def delete_site(db: Session, site_id: int) -> bool:
    site = get_site_by_id(db, site_id)
    if site is None:
        return False
    db.delete(site)
    db.commit()
    return True


def upsert_site_by_code(
    db: Session,
    *,
    code: str,
    name: str,
    base_url: Optional[str] = None,
    enabled: bool = True,
    parser_type: Optional[str] = None,
    settings_json: Optional[dict[str, Any]] = None,
) -> SpiderSite:
    site = get_site_by_code(db, code)
    if site is None:
        return create_site(
            db,
            name=name,
            code=code,
            base_url=base_url,
            enabled=enabled,
            parser_type=parser_type,
            settings_json=settings_json,
        )
    site.name = name
    site.base_url = base_url
    site.enabled = enabled
    site.parser_type = parser_type
    site.settings_json = settings_json or {}
    db.commit()
    db.refresh(site)
    return site


def create_task(
    db: Session,
    task_uuid: str,
    task_type: str = "debug",
    site_id: Optional[int] = None,
    target_url: Optional[str] = None,
    status: str = "pending",
) -> SpiderTask:
    task = SpiderTask(
        task_uuid=task_uuid,
        task_type=task_type,
        site_id=site_id,
        target_url=target_url,
        status=status,
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


def get_task_by_uuid(db: Session, task_uuid: str) -> Optional[SpiderTask]:
    return db.query(SpiderTask).filter(SpiderTask.task_uuid == task_uuid).first()


def list_tasks(db: Session, limit: int = 20) -> list[SpiderTask]:
    return db.query(SpiderTask).order_by(SpiderTask.created_at.desc()).limit(limit).all()


def list_tasks_by_type(db: Session, task_type: str, limit: int = 20) -> list[SpiderTask]:
    return (
        db.query(SpiderTask)
        .filter(SpiderTask.task_type == task_type)
        .order_by(SpiderTask.created_at.desc())
        .limit(limit)
        .all()
    )


def update_task_status(db: Session, task_uuid: str, status: str, **kwargs) -> Optional[SpiderTask]:
    task = get_task_by_uuid(db, task_uuid)
    if task is None:
        return None
    task.status = status
    for key, value in kwargs.items():
        if hasattr(task, key):
            setattr(task, key, value)
    if status == "running" and task.started_at is None:
        task.started_at = datetime.utcnow()
    if status in {"completed", "failed", "cancelled"}:
        task.completed_at = datetime.utcnow()
    db.commit()
    db.refresh(task)
    return task


def append_task_log(db: Session, task_uuid: str, message: str, level: str = "info") -> Optional[TaskLog]:
    task = get_task_by_uuid(db, task_uuid)
    if task is None:
        return None
    log = TaskLog(task_id=task.id, message=message, level=level)
    db.add(log)
    db.commit()
    db.refresh(log)
    return log


def get_task_logs(db: Session, task_uuid: str, limit: int = 200) -> list[TaskLog]:
    task = get_task_by_uuid(db, task_uuid)
    if task is None:
        return []
    return (
        db.query(TaskLog)
        .filter(TaskLog.task_id == task.id)
        .order_by(TaskLog.created_at.asc())
        .limit(limit)
        .all()
    )


def count_tasks(db: Session) -> int:
    return db.query(func.count(SpiderTask.id)).scalar() or 0


def count_running_tasks(db: Session) -> int:
    return db.query(func.count(SpiderTask.id)).filter(SpiderTask.status == "running").scalar() or 0


def count_sites(db: Session, enabled_only: bool = False) -> int:
    query = db.query(func.count(SpiderSite.id))
    if enabled_only:
        query = query.filter(SpiderSite.enabled == True)
    return query.scalar() or 0
