# backend/app/auth/router.py
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import select
from passlib.hash import bcrypt
import jwt, datetime as dt
from ..deps import get_db
from .models import User, UserRole
from .schemas import LoginIn, TokenOut, UserOut

JWT_SECRET = "change-me"  # 환경변수로
JWT_ALG = "HS256"
ACCESS_TTL_MIN = 60

router = APIRouter(prefix="/api/auth", tags=["auth"])


def create_token(user_id: int):
    now = dt.datetime.utcnow()
    payload = {"sub": str(user_id), "iat": now, "exp": now + dt.timedelta(minutes=ACCESS_TTL_MIN)}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def get_current_user(
    db: Session = Depends(get_db),
    token: str | None = Depends(lambda authorization=Depends(lambda: None): None),  # placeholder
):
    # Authorization 헤더 파싱
    from fastapi import Request

    async def _dep(request: Request): ...

    # 간단 버전:
    from fastapi import Header

    auth = None
    try:
        auth = Header(None, alias="Authorization")
    except:
        pass

    # 실제 구현: FastAPI에서는 함수로 분리하는 게 깔끔. 여기선 간단히:
    from fastapi import Request

    def _parse(req: Request):
        authz = req.headers.get("authorization")
        if not authz or not authz.lower().startswith("bearer "):
            raise HTTPException(status_code=401, detail="Not authenticated")
        return authz.split(" ", 1)[1]

    from fastapi import Request

    request: Request
    # FastAPI 의존성 정리 생략… 아래 별도 deps에 깔끔 버전 제공.


@router.post("/login", response_model=TokenOut)
def login(payload: LoginIn, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == payload.email, User.is_active == True))
    if not user or not bcrypt.verify(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="invalid credentials")
    token = create_token(user.id)
    user.last_login_at = dt.datetime.utcnow()
    db.commit()
    return {"access_token": token}


# 편의: 현재 사용자
from fastapi import Depends
from .utils import current_user  # 아래 utils에 깔끔한 버전 제공


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(current_user)):
    return UserOut(id=user.id, email=user.email, name=user.name, role=user.role)
