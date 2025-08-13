from __future__ import annotations
from datetime import datetime
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import (
    ForeignKeyConstraint,
    PrimaryKeyConstraint,
    String,
    Integer,
    DateTime,
    ForeignKey,
    JSON,
    Text,
    UniqueConstraint,
    Index,
    func,
)
from ..shared.db import Base


class WmsBatch(Base):
    __tablename__ = "wms_batch"
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    source: Mapped[str | None] = mapped_column(String(64), nullable=True)
    project_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    uploader: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="received")
    meta_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    received_at: Mapped[datetime | None] = mapped_column(DateTime, server_default=func.now())

    rows: Mapped[list["WmsRow"]] = relationship(
        back_populates="batch", cascade="all, delete-orphan"
    )


class WmsRow(Base):
    __tablename__ = "wms_row"
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    batch_id: Mapped[int] = mapped_column(
        ForeignKey("wms_batch.id", ondelete="CASCADE"), nullable=False
    )
    row_index: Mapped[int] = mapped_column(Integer, nullable=False)
    payload_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="received"
    )  # received|ok|error
    errors_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    batch: Mapped["WmsBatch"] = relationship(back_populates="rows")

    __table_args__ = (
        UniqueConstraint("batch_id", "row_index", name="uq_wms_row_batch_index"),
        Index("ix_wms_row_batch", "batch_id"),
    )


class StdWmsLink(Base):
    __tablename__ = "std_wms_link"
    std_release_id: Mapped[int] = mapped_column(Integer, nullable=False)
    std_node_uid: Mapped[str] = mapped_column(String(255), nullable=False)
    wms_row_id: Mapped[int] = mapped_column(
        ForeignKey("wms_row.id", ondelete="CASCADE"), nullable=False
    )
    assigned_at: Mapped[datetime | None] = mapped_column(DateTime, server_default=func.now())

    __table_args__ = (
        PrimaryKeyConstraint(
            "std_release_id", "std_node_uid", "wms_row_id", name="pk_std_wms_link"
        ),
        # std_nodes에 존재하는 노드에만 링크되도록 (복합 FK)
        ForeignKeyConstraint(
            ["std_release_id", "std_node_uid"],
            ["std_nodes.std_release_id", "std_nodes.std_node_uid"],
            ondelete="CASCADE",
            name="fk_link_stdnode",
        ),
        Index("ix_link_node", "std_release_id", "std_node_uid"),
        Index("ix_link_row", "wms_row_id"),
    )
