# backend/app/locks/schemas.py
from pydantic import BaseModel
from datetime import datetime


class LockAcquireIn(BaseModel):
    resource_type: str  # "STD_RELEASE"
    resource_id: int
    ttl_seconds: int = 120  # 기본 2분


class LockOut(BaseModel):
    id: int
    resource_type: str
    resource_id: int
    user_id: int
    user_name: str
    acquired_at: datetime
    expires_at: datetime
    last_heartbeat_at: datetime
    remaining_sec: int
