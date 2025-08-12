from pydantic import BaseModel, Field
from pydantic import ConfigDict  # ✅ v2
from typing import List, Optional, Any


class StdReleaseCreate(BaseModel):
    version: str = Field(min_length=1, max_length=64)


class StdReleaseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)  # ✅ v2 방식
    id: int
    version: str


class StdNodeOut(BaseModel):
    std_node_uid: str
    parent_uid: Optional[str] = None
    name: str
    level: int
    order_index: int
    path: str
    parent_path: Optional[str] = None
    values_json: Optional[dict[str, Any]] = None


class StdNodeTreeOut(StdNodeOut):
    # ⚠️ 기본값 [] (mutable) 금지 → default_factory 사용
    children: List["StdNodeTreeOut"] = Field(default_factory=list)
