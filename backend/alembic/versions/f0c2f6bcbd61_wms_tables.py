"""wms tables

Revision ID: f0c2f6bcbd61
Revises: 2b473cff468d
Create Date: 2025-08-13 09:34:55.527088

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "f0c2f6bcbd61"
down_revision: Union[str, Sequence[str], None] = "2b473cff468d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(name: str) -> bool:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    return name in insp.get_table_names()


def upgrade() -> None:
    # ✅ WMS 테이블만 생성 (이미 있으면 건너뜀)
    if not _has_table("wms_batch"):
        op.create_table(
            "wms_batch",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("source", sa.String(length=64), nullable=True),
            sa.Column("project_id", sa.Integer(), nullable=True),
            sa.Column("uploader", sa.String(length=255), nullable=True),
            sa.Column("status", sa.String(length=32), nullable=False, server_default="received"),
            sa.Column("meta_json", sa.JSON(), nullable=True),
            sa.Column("received_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP")),
        )

    if not _has_table("wms_row"):
        op.create_table(
            "wms_row",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column(
                "batch_id",
                sa.Integer(),
                sa.ForeignKey("wms_batch.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("row_index", sa.Integer(), nullable=False),
            sa.Column("payload_json", sa.JSON(), nullable=False),
            sa.Column("status", sa.String(length=16), nullable=False, server_default="received"),
            sa.Column("errors_json", sa.JSON(), nullable=True),
        )
        op.create_unique_constraint("uq_wms_row_batch_index", "wms_row", ["batch_id", "row_index"])
        op.create_index("ix_wms_row_batch", "wms_row", ["batch_id"])

    # ❌ (삭제) users 생성/변경 코드
    # op.create_table("users", ...)  ← 전부 제거


def downgrade() -> None:
    # 역방향도 안전하게
    if _has_table("wms_row"):
        op.drop_index("ix_wms_row_batch", table_name="wms_row")
        op.drop_constraint("uq_wms_row_batch_index", "wms_row", type_="unique")
        op.drop_table("wms_row")
    if _has_table("wms_batch"):
        op.drop_table("wms_batch")
