from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

from config import settings


def _load_sqlalchemy():
    try:
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker
    except ImportError as exc:
        raise RuntimeError("SQLAlchemy is not installed. Run pip install -r requirements.txt.") from exc
    return create_engine, sessionmaker


def is_database_enabled() -> bool:
    return bool(settings.database_url)


def get_engine():
    if not settings.database_url:
        return None
    if not settings.database_url.startswith("sqlite"):
        raise RuntimeError("Scholar-E is configured for SQLite only. Use sqlite:///scholar_e.db.")
    create_engine, _ = _load_sqlalchemy()
    return create_engine(settings.database_url, pool_pre_ping=True, future=True)


def get_session_factory():
    engine = get_engine()
    if engine is None:
        return None
    _, sessionmaker = _load_sqlalchemy()
    return sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


@contextmanager
def session_scope() -> Iterator[object | None]:
    factory = get_session_factory()
    if factory is None:
        yield None
        return

    session = factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
