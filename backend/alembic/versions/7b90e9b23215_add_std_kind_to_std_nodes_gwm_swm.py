"""add std_kind to std_nodes (GWM/SWM)

Revision ID: 7b90e9b23215
Revises: 8565be0116c4
Create Date: 2025-08-20 13:20:15.777493
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "7b90e9b23215"
down_revision: Union[str, Sequence[str], None] = "8565be0116c4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

STD_KIND_ENUM = sa.Enum("GWM", "SWM", name="std_kind_enum")


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    is_sqlite = bind.dialect.name == "sqlite"

    # 0) (Postgres일 때만) enum 타입 생성
    if not is_sqlite:
        STD_KIND_ENUM.create(bind, checkfirst=True)

    # 1) 컬럼 추가: 우선 NULL 허용으로 추가 (기존 데이터 때문에)
    with op.batch_alter_table("std_nodes", schema=None) as batch_op:
        batch_op.add_column(sa.Column("std_kind", STD_KIND_ENUM, nullable=True))

        # 기존 인덱스 제거 (모델에 없애기로 했으면)
        batch_op.drop_index(batch_op.f("ix_nodes_release_path"))

    # 2) 데이터 백필 (DB 공통 SQL 사용: UPPER + 서브쿼리)
    #    std_release.version 이 'SWM%' 이면 SWM, 그 외 GWM
    op.execute(
        """
        UPDATE std_nodes
        SET std_kind = CASE
            WHEN (SELECT UPPER(version) FROM std_release r WHERE r.id = std_nodes.std_release_id) LIKE 'SWM%%'
                THEN 'SWM'
            ELSE 'GWM'
        END
        WHERE std_kind IS NULL
        """
    )

    # 3) NOT NULL + 서버 기본값 설정
    with op.batch_alter_table("std_nodes", schema=None) as batch_op:
        batch_op.alter_column(
            "std_kind",
            existing_type=STD_KIND_ENUM,
            nullable=False,
            server_default="GWM",
        )
        # 새 인덱스들 생성
        batch_op.create_index(
            "ix_nodes_release_kind_path",
            ["std_release_id", "std_kind", "path"],
            unique=False,
        )
        batch_op.create_index(
            batch_op.f("ix_std_nodes_std_kind"),
            ["std_kind"],
            unique=False,
        )


def downgrade() -> None:
    """Downgrade schema."""
    bind = op.get_bind()
    is_sqlite = bind.dialect.name == "sqlite"

    with op.batch_alter_table("std_nodes", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_std_nodes_std_kind"))
        batch_op.drop_index("ix_nodes_release_kind_path")
        # 필요하다면 이전 인덱스 복구
        batch_op.create_index(
            batch_op.f("ix_nodes_release_path"),
            ["std_release_id", "path"],
            unique=False,
        )
        batch_op.drop_column("std_kind")

    # (Postgres일 때만) enum 타입 제거
    if not is_sqlite:
        STD_KIND_ENUM.drop(bind, checkfirst=True)
