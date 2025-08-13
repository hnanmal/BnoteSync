from __future__ import annotations
from typing import Any, Optional, List
from pydantic import BaseModel, Field, ConfigDict


class WmsBatchCreate(BaseModel):
    source: Optional[str] = None
    project_id: Optional[int] = None
    uploader: Optional[str] = None
    meta_json: Optional[dict[str, Any]] = None


class WmsIngestRequest(WmsBatchCreate):
    items: List[dict[str, Any]] = Field(default_factory=list)


class WmsBatchOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    source: Optional[str] = None
    status: str
    received_at: Optional[str] = None  # ISO 문자열로 직렬화


class WmsRowOut(BaseModel):
    id: int
    row_index: int
    status: str
    payload_json: dict
    errors_json: Optional[dict] = None


class WmsValidateRequest(BaseModel):
    required_fields: List[str] = Field(default_factory=list)
