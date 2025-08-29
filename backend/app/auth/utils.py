# backend/app/auth/utils.py
from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import select
import jwt, datetime as dt
from ..deps import get_db
from .models import User, UserRole

JWT_SECRET = "change-me"
JWT_ALG = "HS256"


def current_user(db: Session = Depends(get_db), authorization: str | None = Depends(lambda: None)):
    # FastAPI에서 헤더 쉽게 받기
    from fastapi import Header

    token = Header(None, alias="Authorization")
    # 위처럼 하면 타입이 꼬이니, 직접 Request 사용:
    from fastapi import Request

    def _extract(req: Request):
        authz = req.headers.get("authorization")
        if not authz or not authz.lower().startswith("bearer "):
            raise HTTPException(401, "Not authenticated")
        return authz.split(" ", 1)[1]

    from fastapi import Request
    import fastapi

    request: Request = fastapi.requests.Request(scope={})  # placeholder

    # 실제론 FastAPI에서 Request 주입: def current_user(request: Request, db: Session = Depends(get_db)):
    # 여기선 개념만: token = _extract(request)

    # 토큰 디코드
    try:
        data = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired")
    except Exception:
        raise HTTPException(401, "Invalid token")
    uid = int(data["sub"])
    user = db.get(User, uid)
    if not user or not user.is_active:
        raise HTTPException(401, "User disabled")
    return user


def require_roles(*roles: UserRole):
    def _dep(user: User = Depends(current_user)):
        if roles and user.role not in roles:
            raise HTTPException(403, "Forbidden")
        return user

    return _dep
