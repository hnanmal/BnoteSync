# backend/app/standards/guard.py
from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import select
from ..deps import get_db
from ..auth.utils import current_user
from ..auth.models import User, EditLock, ResourceType
from ..locks.router import _now


def require_release_lock(
    rid: int, db: Session = Depends(get_db), user: User = Depends(current_user)
):
    lock = db.scalar(
        select(EditLock).where(
            EditLock.resource_type == ResourceType.std_release,
            EditLock.resource_id == rid,
            EditLock.expires_at > _now(),
        )
    )
    if not lock or lock.user_id != user.id:
        raise HTTPException(
            status_code=423, detail="This release is locked by another user or not locked."
        )
    return True
