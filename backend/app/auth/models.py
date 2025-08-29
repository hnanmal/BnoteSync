# backend/app/auth/models.py
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import String, Integer, DateTime, Enum, ForeignKey, UniqueConstraint, Index, func
import enum
from ..shared.db import Base  # 네가 쓰는 Base


class UserRole(str, enum.Enum):
    admin = "admin"
    editor = "editor"
    viewer = "viewer"


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[UserRole] = mapped_column(Enum(UserRole), default=UserRole.editor)
    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())
    last_login_at: Mapped[DateTime | None] = mapped_column(DateTime, nullable=True)


class ResourceType(str, enum.Enum):
    std_release = "STD_RELEASE"


class EditLock(Base):
    __tablename__ = "edit_locks"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    resource_type: Mapped[ResourceType] = mapped_column(Enum(ResourceType), index=True)
    resource_id: Mapped[int] = mapped_column(Integer, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    acquired_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())
    last_heartbeat_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())
    expires_at: Mapped[DateTime] = mapped_column(DateTime, index=True)

    __table_args__ = (
        # 같은 리소스에는 동시에 1개만(만료 전제). SQLite라 부분 Unique는 못 쓰니 코드에서 보장.
        Index("ix_edit_locks_resource", "resource_type", "resource_id"),
    )
