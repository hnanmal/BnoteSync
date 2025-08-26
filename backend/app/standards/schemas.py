from __future__ import annotations
from enum import Enum
from typing import List, Optional, Any

from pydantic import BaseModel, Field
from pydantic import ConfigDict  # ✅ v2


# ------------------------
# Release
# ------------------------
# 릴리즈 상태 Enum (응답 직렬화용)
class ReleaseStatus(str, Enum):
    DRAFT = "DRAFT"
    ACTIVE = "ACTIVE"
    ARCHIVED = "ARCHIVED"


class StdReleaseCreate(BaseModel):
    version: str = Field(min_length=1, max_length=64)


class StdReleaseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)  # ✅ ORM 출력 허용
    id: int
    version: str
    status: ReleaseStatus  # ✅ 추가


# 새 드래프트(복제) 입력
class StdReleaseCloneIn(BaseModel):
    version: str = Field(min_length=1, max_length=64)
    copy_links: bool = True


# 상태 변경 입력
class StdReleaseStatusIn(BaseModel):
    status: ReleaseStatus


# ------------------------
# 공통: GWM/SWM 구분
# ------------------------
class StdKind(str, Enum):
    GWM = "GWM"
    SWM = "SWM"


# ------------------------
# Node 입력 스키마
# ------------------------
class StdNodeCreate(BaseModel):
    std_node_uid: str = Field(min_length=1, max_length=128)  # 공백 없이 안정키
    name: str = Field(min_length=1, max_length=255)
    parent_uid: Optional[str] = None  # 루트면 None
    order_index: int = 0
    values_json: Optional[dict[str, Any]] = None  # 선택
    # ✅ 루트 생성 시에만 의미 있음(서버에서: 자식은 부모 std_kind 강제 상속)
    std_kind: Optional[StdKind] = None


class StdNodeUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=255)
    parent_uid: Optional[str] = None
    order_index: Optional[int] = None
    values_json: Optional[dict[str, Any]] = None
    # ❌ std_kind는 수정 불가(서버에서 금지)


# ------------------------
# Node 출력 스키마
# ------------------------
class StdNodeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)  # ✅ ORM 출력 허용
    std_node_uid: str
    parent_uid: Optional[str] = None
    name: str
    level: int
    order_index: int
    path: str
    parent_path: Optional[str] = None
    values_json: Optional[dict[str, Any]] = None
    std_kind: StdKind  # ✅ 응답에 kind 포함


class StdNodeTreeOut(StdNodeOut):
    # ⚠️ 기본값 [] (mutable) 금지 → default_factory 사용
    children: List["StdNodeTreeOut"] = Field(default_factory=list)


# ✅ 순환 참조 해결(Pydantic v2)
StdNodeTreeOut.model_rebuild()
