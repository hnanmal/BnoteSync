"""std tables

Revision ID: a7f406eadfd1
Revises: 156620640f7c
Create Date: 2025-08-12 16:08:05.905918

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "a7f406eadfd1"
down_revision: Union[str, Sequence[str], None] = "156620640f7c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "std_release",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("version", sa.String(length=64), nullable=False, unique=True),
        sa.Column(
            "created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=True
        ),
    )

    op.create_table(
        "std_nodes",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "std_release_id",
            sa.Integer(),
            sa.ForeignKey("std_release.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("std_node_uid", sa.String(length=255), nullable=False),
        sa.Column("parent_uid", sa.String(length=255), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("level", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("order_index", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("path", sa.Text(), nullable=False, server_default=""),
        sa.Column("parent_path", sa.Text(), nullable=True),
        sa.Column("values_json", sa.JSON(), nullable=True),
        sa.UniqueConstraint("std_release_id", "std_node_uid", name="uq_release_uid"),
    )
    op.create_index("ix_nodes_release_path", "std_nodes", ["std_release_id", "path"])


def downgrade() -> None:
    op.drop_index("ix_nodes_release_path", table_name="std_nodes")
    op.drop_table("std_nodes")
    op.drop_table("std_release")
