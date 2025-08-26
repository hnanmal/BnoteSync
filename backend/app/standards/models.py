from __future__ import annotations
import enum  # ✅ 추가
from datetime import datetime  # ✅ 이 줄 추가
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import (
    String,
    Integer,
    Text,
    ForeignKey,
    Index,
    UniqueConstraint,
    JSON,
    func,
    DateTime,
    Enum as SAEnum,  # ✅ 추가
)
from ..shared.db import Base


class ReleaseStatus(str, enum.Enum):
    DRAFT = "DRAFT"
    ACTIVE = "ACTIVE"
    ARCHIVED = "ARCHIVED"


class StdRelease(Base):
    __tablename__ = "std_release"
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    version: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())  # ✅

    # ✅ 새 컬럼
    status: Mapped[ReleaseStatus] = mapped_column(
        SAEnum(ReleaseStatus, name="release_status_enum"),
        nullable=False,
        default=ReleaseStatus.DRAFT,
    )

    nodes: Mapped[list["StdNode"]] = relationship(
        back_populates="release", cascade="all, delete-orphan"
    )


class StdKind(enum.Enum):
    GWM = "GWM"
    SWM = "SWM"


class StdNode(Base):
    __tablename__ = "std_nodes"
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    std_release_id: Mapped[int] = mapped_column(
        ForeignKey("std_release.id", ondelete="CASCADE"), nullable=False
    )

    std_node_uid: Mapped[str] = mapped_column(String(255), nullable=False)  # stable key
    parent_uid: Mapped[str | None] = mapped_column(String(255), nullable=True)

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    level: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    order_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    path: Mapped[str] = mapped_column(Text, nullable=False, default="")  # e.g. "EARTH/EXCAVATION"
    parent_path: Mapped[str] = mapped_column(Text, nullable=True)  # e.g. "EARTH"

    # ✅ 새 컬럼: GWM/SWM 구분 (DB Enum 이름 고정)
    std_kind: Mapped[StdKind] = mapped_column(
        SAEnum(StdKind, name="std_kind_enum"),
        nullable=False,
        default=StdKind.GWM,
        index=True,
    )

    values_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    release: Mapped["StdRelease"] = relationship(back_populates="nodes")

    __table_args__ = (
        UniqueConstraint("std_release_id", "std_node_uid", name="uq_release_uid"),
        # Index("ix_nodes_release_path", "std_release_id", "path"),
        Index("ix_nodes_release_kind_path", "std_release_id", "std_kind", "path"),
    )
