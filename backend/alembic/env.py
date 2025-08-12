import sys, pathlib, os
from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool
from alembic import context

from app.standards import models as standards_models  # <- 등록을 위해 import만 해도 됨
from app.auth import models as auth_models  # 앞으로 다른 도메인도 여기에 추가

# backend 루트를 sys.path에 추가
BASE_DIR = pathlib.Path(__file__).resolve().parents[1]
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from app.shared.db import Base  # ← 여기서 Base.metadata 가져옴
from app.shared.config import settings

# Alembic Config 객체
config = context.config

# DB URL 환경변수 또는 settings에서 불러오기
db_url = os.getenv("DATABASE_URL", settings.DATABASE_URL)
if db_url:
    config.set_main_option("sqlalchemy.url", db_url)

# 로깅 설정
if config.config_file_name:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline():
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        compare_type=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online():
    connectable = engine_from_config(
        config.get_section(config.config_ini_section),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
