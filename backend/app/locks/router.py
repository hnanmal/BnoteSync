# backend/app/locks/router.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import select, update, delete, func
from datetime import datetime, timedelta, timezone
from ..deps import get_db
from ..auth.utils import current_user, require_roles
from ..auth.models import User, UserRole
from .schemas import LockAcquireIn, LockOut
from ..auth.models import EditLock, ResourceType

router = APIRouter(prefix="/api/locks", tags=["locks"])


def _now():
    return datetime.now(timezone.utc)


def _to_out(db, lock: EditLock) -> LockOut:
    from ..auth.models import User

    u = db.get(User, lock.user_id)
    rem = int((lock.expires_at - _now()).total_seconds())
    return LockOut(
        id=lock.id,
        resource_type=lock.resource_type.value,
        resource_id=lock.resource_id,
        user_id=lock.user_id,
        user_name=u.name if u else f"#{lock.user_id}",
        acquired_at=lock.acquired_at,
        last_heartbeat_at=lock.last_heartbeat_at,
        expires_at=lock.expires_at,
        remaining_sec=max(rem, 0),
    )


@router.get("")
def get_lock(resource_type: ResourceType, resource_id: int, db: Session = Depends(get_db)):
    lock = db.scalar(
        select(EditLock).where(
            EditLock.resource_type == resource_type,
            EditLock.resource_id == resource_id,
            EditLock.expires_at > _now(),
        )
    )
    if not lock:
        return None
    return _to_out(db, lock)


@router.post("/acquire", response_model=LockOut)
def acquire_lock(
    req: LockAcquireIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(UserRole.admin, UserRole.editor)),
):
    # 만료된 잠금 정리
    db.execute(delete(EditLock).where(EditLock.expires_at <= _now()))
    db.flush()

    # 기존 잠금 확인
    cur = db.scalar(
        select(EditLock).where(
            EditLock.resource_type == ResourceType(req.resource_type),
            EditLock.resource_id == req.resource_id,
            EditLock.expires_at > _now(),
        )
    )
    if cur and cur.user_id != user.id:
        raise HTTPException(status_code=409, detail=f"Locked by {cur.user_id}")

    ttl = max(30, min(req.ttl_seconds, 600))
    exp = _now() + timedelta(seconds=ttl)
    if cur and cur.user_id == user.id:
        cur.expires_at = exp
        cur.last_heartbeat_at = _now()
        db.commit()
        db.refresh(cur)
        return _to_out(db, cur)

    lock = EditLock(
        resource_type=ResourceType(req.resource_type),
        resource_id=req.resource_id,
        user_id=user.id,
        acquired_at=_now(),
        last_heartbeat_at=_now(),
        expires_at=exp,
    )
    db.add(lock)
    db.commit()
    db.refresh(lock)
    return _to_out(db, lock)


@router.post("/heartbeat", response_model=LockOut)
def heartbeat(
    lock_id: int,
    ttl_seconds: int = 120,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    lock = db.get(EditLock, lock_id)
    if not lock:
        raise HTTPException(404, "lock not found")
    if lock.user_id != user.id:
        raise HTTPException(403, "not owner")
    if lock.expires_at <= _now():
        raise HTTPException(409, "expired")

    ttl = max(30, min(ttl_seconds, 600))
    lock.expires_at = _now() + timedelta(seconds=ttl)
    lock.last_heartbeat_at = _now()
    db.commit()
    db.refresh(lock)
    return _to_out(db, lock)


@router.post("/release")
def release(lock_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    lock = db.get(EditLock, lock_id)
    if not lock:
        return {"released": False}
    if lock.user_id != user.id:
        raise HTTPException(403, "not owner")
    db.delete(lock)
    db.commit()
    return {"released": True}


@router.post("/force-release")
def force_release(
    resource_type: ResourceType,
    resource_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_roles(UserRole.admin)),
):
    db.execute(
        delete(EditLock).where(
            EditLock.resource_type == resource_type, EditLock.resource_id == resource_id
        )
    )
    db.commit()
    return {"released": True}
