from __future__ import annotations
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from sqlalchemy import create_engine
from .config import settings

class Base(DeclarativeBase):
    pass

DB_URL = settings.DATABASE_URL
connect_args = {"check_same_thread": False} if DB_URL.startswith("sqlite") else {}
engine = create_engine(DB_URL, echo=False, future=True, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
