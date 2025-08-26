"""add release status to std_release

Revision ID: 0c930f575745
Revises: 7b90e9b23215
Create Date: 2025-08-26 10:40:37.707703

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0c930f575745"
down_revision: Union[str, Sequence[str], None] = "7b90e9b23215"
branch_labels = None
depends_on = None

STATUS_NAME = "release_status_enum"


def upgrade() -> None:
    bind = op.get_bind()
    status_enum = sa.Enum("DRAFT", "ACTIVE", "ARCHIVED", name=STATUS_NAME)
    status_enum.create(bind, checkfirst=True)

    with op.batch_alter_table("std_release") as batch:
        batch.add_column(sa.Column("status", status_enum, nullable=False, server_default="DRAFT"))

    # 기존 행 백필 후 server_default 제거
    op.execute("UPDATE std_release SET status='DRAFT' WHERE status IS NULL")
    with op.batch_alter_table("std_release") as batch:
        batch.alter_column("status", server_default=None)


def downgrade() -> None:
    bind = op.get_bind()
    with op.batch_alter_table("std_release") as batch:
        batch.drop_column("status")
    status_enum = sa.Enum("DRAFT", "ACTIVE", "ARCHIVED", name=STATUS_NAME)
    status_enum.drop(bind, checkfirst=True)
