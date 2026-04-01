from contextlib import contextmanager
from typing import Generator, Optional
import os

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from .models import Base


class DatabaseSessionManager:
    def __init__(self, database_url: Optional[str] = None):
        if database_url is None:
            database_url = os.environ.get("APP_DATABASE_URL")
            if not database_url:
                data_dir = os.environ.get("APP_DATA_DIR") or os.path.join(
                    os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
                    "data",
                )
                os.makedirs(data_dir, exist_ok=True)
                database_url = f"sqlite:///{os.path.join(data_dir, 'spider_console.db')}"

        self.database_url = database_url
        self.engine = create_engine(
            self.database_url,
            connect_args={"check_same_thread": False} if self.database_url.startswith("sqlite") else {},
            pool_pre_ping=True,
        )
        self.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=self.engine)

    def create_tables(self):
        Base.metadata.create_all(bind=self.engine)


_db_manager: Optional[DatabaseSessionManager] = None


def init_database(database_url: Optional[str] = None) -> DatabaseSessionManager:
    global _db_manager
    if _db_manager is None:
        _db_manager = DatabaseSessionManager(database_url)
        _db_manager.create_tables()
    return _db_manager


def get_session_manager() -> DatabaseSessionManager:
    if _db_manager is None:
        raise RuntimeError("Database not initialized")
    return _db_manager


@contextmanager
def get_db() -> Generator[Session, None, None]:
    manager = get_session_manager()
    db = manager.SessionLocal()
    try:
        yield db
    finally:
        db.close()
