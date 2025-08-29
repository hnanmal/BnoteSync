from typing import Iterable, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import select, func, case
from sqlalchemy import delete as sa_delete
from sqlalchemy import select as sa_select, and_ as sa_and_
import sqlalchemy as sa  # ✅ 추가
from ..deps import get_db
from . import models as m
from . import schemas as s
from fastapi import UploadFile, File, Form
from io import BytesIO
import pandas as pd
import numpy as np


router = APIRouter(prefix="/api/wms", tags=["wms"])


# === helpers: current batch selection ===
def _pick_current_batch_for_source(db: Session, source: str) -> Optional[m.WmsBatch]:
    """is_current=true 우선, 없으면 validated 최신 → 없으면 가장 최신."""
    rows = (
        db.execute(
            select(m.WmsBatch).where(m.WmsBatch.source == source).order_by(m.WmsBatch.id.desc())
        )
        .scalars()
        .all()
    )
    if not rows:
        return None
    # 1) meta_json.is_current == True
    for b in rows:
        mj = b.meta_json or {}
        if mj.get("is_current") is True:
            return b
    # 2) validated 최신
    for b in rows:
        if (b.status or "").lower() == "validated":
            return b
    # 3) 최신 아무거나
    return rows[0]


def _pick_current_batch_ids(db: Session, sources: list[str]) -> dict[str, int]:
    out: dict[str, int] = {}
    for s in sources:
        b = _pick_current_batch_for_source(db, s)
        if b:
            out[s] = int(b.id)
    return out


@router.post("/ingest")
def ingest(payload: s.WmsIngestRequest, db: Session = Depends(get_db)):
    try:
        batch = m.WmsBatch(
            source=payload.source,
            project_id=payload.project_id,
            uploader=payload.uploader,
            meta_json=payload.meta_json,
            status="received",
        )
        db.add(batch)
        db.flush()  # get batch.id

        for i, item in enumerate(payload.items):
            db.add(m.WmsRow(batch_id=batch.id, row_index=i, payload_json=item, status="received"))
        db.commit()
        return {"batch_id": batch.id, "count": len(payload.items)}
    except Exception as e:
        import traceback

        traceback.print_exc()
        db.rollback()
        raise HTTPException(status_code=500, detail=f"{type(e).__name__}: {e}")


# /api/wms/batches  (기존 함수 교체)
@router.get("/batches")
def list_batches(
    source: str | None = Query(None, description="AR|FP|SS"),
    limit: int | None = Query(None, ge=1),
    db: Session = Depends(get_db),
):
    total = func.count(m.WmsRow.id)
    errors = func.sum(case((m.WmsRow.status == "error", 1), else_=0))
    oks = func.sum(case((m.WmsRow.status == "ok", 1), else_=0))

    q = (
        select(
            m.WmsBatch.id,
            m.WmsBatch.source,
            m.WmsBatch.status,
            m.WmsBatch.received_at,
            m.WmsBatch.meta_json,
            total.label("total_rows"),
            errors.label("error_rows"),
            oks.label("ok_rows"),
        )
        .select_from(m.WmsBatch)
        .join(m.WmsRow, m.WmsRow.batch_id == m.WmsBatch.id, isouter=True)
        .group_by(m.WmsBatch.id)
        .order_by(m.WmsBatch.id.desc())
    )
    if source:
        q = q.where(m.WmsBatch.source == source)
    if limit:
        q = q.limit(limit)

    rows = db.execute(q).all()
    return [
        {
            "id": r.id,
            "source": r.source,
            "status": r.status,
            "received_at": r.received_at,
            "total_rows": int(r.total_rows or 0),
            "error_rows": int(r.error_rows or 0),
            "ok_rows": int(r.ok_rows or 0),
            "is_current": bool((r.meta_json or {}).get("is_current")),  # ✅ mj 대신 inline
        }
        for r in rows
    ]


# @router.get("/batches/{batch_id}/preview", response_model=list[s.WmsRowOut])
def preview_batch(
    batch_id: int,
    # ✅ limit을 선택값으로. None이면 전체 반환
    limit: int | None = Query(None),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    q = select(m.WmsRow).where(m.WmsRow.batch_id == batch_id).order_by(m.WmsRow.row_index.asc())
    if limit is not None:
        q = q.limit(limit).offset(offset)
    rows = db.execute(q).scalars().all()
    return [
        {
            "id": r.id,
            "row_index": r.row_index,
            "status": r.status,
            "payload_json": r.payload_json,
            "errors_json": r.errors_json,
        }
        for r in rows
    ]


@router.post("/batches/{batch_id}/validate")
def validate_batch(batch_id: int, req: s.WmsValidateRequest, db: Session = Depends(get_db)):
    # 간단 규칙: required_fields 모두 존재하고 빈값이 아니면 ok, 아니면 error
    rows = db.execute(select(m.WmsRow).where(m.WmsRow.batch_id == batch_id)).scalars().all()
    if not rows:
        raise HTTPException(status_code=404, detail="batch not found or empty")

    error_count = 0
    for r in rows:
        errs = []
        for k in req.required_fields:
            v = r.payload_json.get(k)
            if v is None or (isinstance(v, str) and v.strip() == ""):
                errs.append(f"Missing/empty field: {k}")
        if errs:
            r.status = "error"
            r.errors_json = {"messages": errs}
            error_count += 1
        else:
            r.status = "ok"
            r.errors_json = None

    # 배치 상태 갱신
    batch = db.get(m.WmsBatch, batch_id)
    if batch:
        batch.status = "validated" if error_count == 0 else "invalid"

    db.commit()
    return {
        "batch_id": batch_id,
        "errors": error_count,
        "total": len(rows),
        "status": batch.status if batch else None,
    }


@router.get("/batches/{batch_id}/errors", response_model=list[s.WmsRowOut])
def list_errors(batch_id: int, db: Session = Depends(get_db)):
    rows = (
        db.execute(
            select(m.WmsRow)
            .where(m.WmsRow.batch_id == batch_id, m.WmsRow.status == "error")
            .order_by(m.WmsRow.row_index.asc())
        )
        .scalars()
        .all()
    )
    return [
        {
            "id": r.id,
            "row_index": r.row_index,
            "status": r.status,
            "payload_json": r.payload_json,
            "errors_json": r.errors_json,
        }
        for r in rows
    ]


def _normalize_work_master_excel(file_bytes: bytes, sheet_name: str | None = None):
    """
    반환: (items, raw_columns)
      - items: 각 행 dict: { code, name, qty, unit, group_code, _raw: {<원본헤더(디듀프)>: 값, ...} }
      - raw_columns: 디듀프된 원본 컬럼명 리스트(표시 순서)
    """
    xls = pd.ExcelFile(BytesIO(file_bytes))
    sheet = sheet_name or xls.sheet_names[0]
    raw = pd.read_excel(xls, sheet_name=sheet, header=None)

    # 헤더 2행 탐지 (Discipline가 포함된 행 + 다음 행)
    h1_candidates = raw.index[raw.iloc[:, 0].astype(str).str.contains("Discipline", na=False)]
    h1 = int(h1_candidates.min()) if len(h1_candidates) else 0
    h2 = h1 + 1

    top = raw.iloc[h1].fillna("").astype(str).tolist()
    sub = raw.iloc[h2].fillna("").astype(str).tolist()
    cols_flat = []
    for a, b in zip(top, sub):
        a = a.strip()
        b = b.strip()
        name = f"{a} {b}".strip()
        cols_flat.append(name if name else "unnamed")

    # 본문 + 인덱스 리셋
    df = raw.iloc[h2 + 1 :].copy()
    df = df.dropna(how="all").reset_index(drop=True)

    # 열 이름 디듀프 (중복 시 __2, __3 ... 접미사)
    counts = {}
    dedup_cols = []
    for name in cols_flat:
        key = name or "unnamed"
        counts[key] = counts.get(key, 0) + 1
        dedup_cols.append(key if counts[key] == 1 else f"{key}__{counts[key]}")
    df.columns = dedup_cols
    raw_columns = dedup_cols[:]  # UI/메타로 반환할 원본 열 목록

    # 토큰 매칭을 "원본(flat) 컬럼명" 기준으로 인덱스 반환
    def find_idx(cands: list[str]) -> int | None:
        for i, c in enumerate(cols_flat):
            for cand in cands:
                if cand.lower() in c.lower():
                    return i
        return None

    idx_desc = find_idx(["Category(Middle) Description"]) or find_idx(["Description"])
    idx_wc = find_idx(["Work Master", "Work Master Code"])
    idx_qty = find_idx(["Qty", "Quantity"])
    idx_uom = find_idx(["UoM1", "UoM 1", "UoM"])
    idx_group = find_idx(["Work Group Code"])

    # 인덱스 기반 시리즈 (중복 라벨과 무관)
    def series_by_idx(idx: int | None) -> pd.Series:
        if idx is None or idx < 0 or idx >= len(dedup_cols):
            return pd.Series([None] * len(df), index=df.index)
        return df.iloc[:, idx]

    name_s = series_by_idx(idx_desc)
    code_s = series_by_idx(idx_wc)
    qty_s = pd.to_numeric(series_by_idx(idx_qty), errors="coerce")
    unit_s = series_by_idx(idx_uom)
    group_s = series_by_idx(idx_group)

    # 상단 정규화 필드 프레임(동일 인덱스)
    norm = pd.DataFrame(
        {"code": code_s, "name": name_s, "qty": qty_s, "unit": unit_s, "group_code": group_s},
        index=df.index,
    )

    # 'Description' 헤더 잔재 행 제거
    mask_header = norm["name"].astype(str).str.strip().str.lower().eq("description")
    keep_idx = norm.index[~mask_header]

    def clean_scalar(v):
        # 위치 기반으로 가져오기 때문에 v는 스칼라
        if v is None:
            return None
        try:
            if pd.isna(v):
                return None
        except Exception:
            pass
        if isinstance(v, str):
            s = v.strip()
            return s if s != "" and s.lower() != "nan" else None
        if isinstance(v, (pd.Timestamp,)):
            return v.isoformat()
        if isinstance(v, (int, float, np.number)):
            return float(v)
        return v

    items: list[dict] = []
    for i in keep_idx:
        row = df.loc[i]

        # 원본 전체 컬럼: 위치 기반으로 값 추출 → 디듀프된 컬럼명으로 매핑
        raw_map = {}
        for j, col_name in enumerate(raw_columns):
            v = row.iloc[j]  # ← 위치 기반 (Series 아님)
            raw_map[col_name] = clean_scalar(v)

        itm = {
            "code": clean_scalar(norm.at[i, "code"]) or "",
            "name": clean_scalar(norm.at[i, "name"]),
            "qty": clean_scalar(norm.at[i, "qty"]),
            "unit": clean_scalar(norm.at[i, "unit"]),
            "group_code": clean_scalar(norm.at[i, "group_code"]),
            "_raw": raw_map,  # 원본 전체 보존
        }
        items.append(itm)

    return items, raw_columns


@router.post("/upload-excel")
def upload_excel(
    file: UploadFile = File(...),
    source: str | None = Form(None),
    project_id: int | None = Form(None),
    sheet: str | None = Form(None),
    dry_run: bool = Form(False),
    db: Session = Depends(get_db),
):
    """
    엑셀 파일(Work Master 형식)을 업로드하고 items로 정규화한 뒤,
    dry_run=False면 즉시 WMS에 인제스트합니다.
    """
    try:
        content = file.file.read()
        items, raw_cols = _normalize_work_master_excel(content, sheet_name=sheet)

        if dry_run or not items:
            return {
                "dry_run": True,
                "detected_items": len(items),
                "sample": items[:5],
                "source": source,
                "sheet_used": sheet,
                "raw_columns": raw_cols,  # ✅ 원본 컬럼 리스트 반환
            }

        # 인제스트 (기존 /wms/ingest 로직을 내부에서 그대로 수행)
        batch = m.WmsBatch(
            source=source or file.filename,
            project_id=project_id,
            uploader="upload",
            status="received",
            meta_json={
                "filename": file.filename,
                "sheet": sheet,
                "raw_columns": raw_cols,
            },  # ✅ 메타에 보존
        )
        db.add(batch)
        db.flush()

        for i, it in enumerate(items):
            db.add(
                m.WmsRow(
                    batch_id=batch.id,
                    row_index=i,
                    payload_json=it,
                    status="received",
                )
            )
        db.commit()
        return {"batch_id": batch.id, "count": len(items), "source": batch.source}
    except Exception as e:
        import traceback

        traceback.print_exc()
        db.rollback()
        raise HTTPException(status_code=500, detail=f"{type(e).__name__}: {e}")


@router.delete("/batches/{batch_id}", status_code=status.HTTP_200_OK)
def delete_batch(batch_id: int, db: Session = Depends(get_db)):
    """
    배치 1건과 그 하위 rows 전체 삭제.
    SQLite에서는 PRAGMA foreign_keys=ON + FK(ondelete='CASCADE')가 필요합니다.
    """
    try:
        batch = db.get(m.WmsBatch, batch_id)
        if not batch:
            raise HTTPException(status_code=404, detail="batch not found")

        # DB FK ondelete='CASCADE'가 있지만, 안전하게 하위 먼저 삭제해도 OK
        db.execute(sa_delete(m.WmsRow).where(m.WmsRow.batch_id == batch_id))
        db.delete(batch)
        db.commit()
        return {"deleted": True, "batch_id": batch_id}
    except Exception as e:
        import traceback

        traceback.print_exc()
        db.rollback()
        raise HTTPException(status_code=500, detail=f"{type(e).__name__}: {e}")


# 통합 아이템 목록 (AR/FP/SS 통합, 필터/검색/페이지네이션)
@router.get("/items")
def list_items(
    sources: Optional[str] = Query(None, description="AR,FP,SS"),
    search: Optional[str] = Query(None),
    limit: int | None = Query(None),
    offset: int = Query(0, ge=0),
    order: str = Query("asc"),
    batch_id: int | None = Query(None, description="이 배치의 행만 조회"),
    batch_ids: str | None = Query(None, description="쉼표구분 배치들: '7,8,12'"),
    db: Session = Depends(get_db),
):
    if order not in ("asc", "desc"):
        raise HTTPException(400, "order must be 'asc' or 'desc'")

    src_list = [s.strip() for s in sources.split(",")] if sources else None
    ids_list = None
    if batch_ids:
        try:
            ids_list = [int(x) for x in batch_ids.split(",") if x.strip()]
        except Exception:
            raise HTTPException(400, "batch_ids must be comma-separated integers")

    q = (
        select(m.WmsRow.id, m.WmsBatch.source, m.WmsRow.payload_json, m.WmsRow.batch_id)
        .join(m.WmsBatch, m.WmsBatch.id == m.WmsRow.batch_id)
        .order_by(m.WmsRow.id.asc() if order == "asc" else m.WmsRow.id.desc())
    )
    if src_list:
        q = q.where(m.WmsBatch.source.in_(src_list))
    if ids_list:
        q = q.where(m.WmsRow.batch_id.in_(ids_list))
    elif batch_id is not None:
        q = q.where(m.WmsRow.batch_id == batch_id)

    rows = db.execute(q).all()
    s_lower = (search or "").lower()
    items = []

    for r in rows:
        p = r.payload_json or {}
        raw = p.get("_raw") if isinstance(p, dict) else {}
        code = (p.get("code") or "") if isinstance(p, dict) else ""
        name = (p.get("name") or "") if isinstance(p, dict) else ""

        # ✅ 검색: code/name + raw 전체 값에서 부분일치
        if s_lower:
            hit = any(s_lower in str(v).lower() for v in (code, name))
            if not hit and isinstance(raw, dict):
                for v in raw.values():
                    try:
                        if s_lower in str(v).lower():
                            hit = True
                            break
                    except Exception:
                        pass
            if not hit:
                continue

        items.append(
            {
                "row_id": int(r.id),
                "source": r.source,
                "code": code,
                "name": name,
                "unit": (p.get("unit") if isinstance(p, dict) else None),
                "qty": (p.get("qty") if isinstance(p, dict) else None),
                "_raw": raw,  # ✅ 프론트가 여기서 모든 컬럼을 꺼내 쓸 것
            }
        )

    # ✅ 검색 후 최종 정렬
    items.sort(key=lambda x: x["row_id"], reverse=(order == "desc"))

    # ✅ 정렬 이후 슬라이스
    if limit is not None:
        items = items[offset : offset + limit]

    return items


@router.get("/links", response_model=list[s.WmsLinkedItemOut])
def list_links(
    rid: int = Query(...),
    uid: str = Query(...),
    order: str = Query("asc"),
    source: str | None = Query(None, description="AR|FP|SS"),
    batch_id: int | None = Query(None, description="이 배치의 링크만"),
    batch_ids: str | None = Query(None, description="쉼표구분 배치들"),
    db: Session = Depends(get_db),
):
    if order not in ("asc", "desc"):
        raise HTTPException(400, "order must be 'asc' or 'desc'")

    ids_list = None
    if batch_ids:
        try:
            ids_list = [int(x) for x in batch_ids.split(",") if x.strip()]
        except Exception:
            raise HTTPException(400, "batch_ids must be comma-separated integers")

    q = (
        select(m.WmsRow.id, m.WmsBatch.source, m.WmsRow.payload_json, m.WmsRow.batch_id)
        .join(m.WmsBatch, m.WmsBatch.id == m.WmsRow.batch_id)
        .join(m.StdWmsLink, m.StdWmsLink.wms_row_id == m.WmsRow.id)
        .where(
            m.StdWmsLink.std_release_id == rid,
            m.StdWmsLink.std_node_uid == uid,
        )
        .order_by(m.WmsRow.id.asc() if order == "asc" else m.WmsRow.id.desc())
    )
    if source:
        q = q.where(m.WmsBatch.source == source)
    if ids_list:
        q = q.where(m.WmsRow.batch_id.in_(ids_list))
    elif batch_id is not None:
        q = q.where(m.WmsRow.batch_id == batch_id)

    rows = db.execute(q).all()
    return [
        {
            "row_id": int(r.id),
            "source": r.source,
            "code": (r.payload_json or {}).get("code") or "",
            "name": (r.payload_json or {}).get("name") or "",
            "unit": (r.payload_json or {}).get("unit"),
            "qty": (r.payload_json or {}).get("qty"),
            "_raw": (r.payload_json or {}).get("_raw") or {},
        }
        for r in rows
    ]


# 다중 할당
@router.post("/links/assign")
def assign_links(
    payload: dict,
    db: Session = Depends(get_db),
):
    """
    body: { "std_release_id": 1, "std_node_uid": "EARTH/...", "row_ids": [1,2,3] }
    """
    try:
        rid = int(payload.get("std_release_id"))
        uid = str(payload.get("std_node_uid"))
        ids: Iterable[int] = payload.get("row_ids") or []
        if not uid or not ids:
            raise HTTPException(status_code=400, detail="invalid request")

        # 중복 방지: 이미 존재하는 것은 건너뜀
        existing = set(
            db.execute(
                select(m.StdWmsLink.wms_row_id).where(
                    m.StdWmsLink.std_release_id == rid,
                    m.StdWmsLink.std_node_uid == uid,
                    m.StdWmsLink.wms_row_id.in_(ids),
                )
            )
            .scalars()
            .all()
        )
        to_add = [i for i in ids if i not in existing]
        for row_id in to_add:
            db.add(m.StdWmsLink(std_release_id=rid, std_node_uid=uid, wms_row_id=row_id))
        db.commit()
        return {"added": len(to_add), "skipped": len(existing)}
    except HTTPException:
        raise
    except Exception as e:
        import traceback

        traceback.print_exc()
        db.rollback()
        raise HTTPException(status_code=500, detail=f"{type(e).__name__}: {e}")


# 다중 해제
@router.post("/links/unassign")
def unassign_links(
    payload: dict,
    db: Session = Depends(get_db),
):
    """
    body: { "std_release_id": 1, "std_node_uid": "EARTH/...", "row_ids": [1,2,3] }
    """
    rid = int(payload.get("std_release_id"))
    uid = str(payload.get("std_node_uid"))
    ids: Iterable[int] = payload.get("row_ids") or []
    if not uid or not ids:
        raise HTTPException(status_code=400, detail="invalid request")

    db.execute(
        sa_delete(m.StdWmsLink).where(
            m.StdWmsLink.std_release_id == rid,
            m.StdWmsLink.std_node_uid == uid,
            m.StdWmsLink.wms_row_id.in_(ids),
        )
    )
    db.commit()
    return {"removed": len(list(ids))}


# set current for a batch
@router.post("/batches/{batch_id}/set-current")
def set_current_batch(batch_id: int, db: Session = Depends(get_db)):
    batch = db.get(m.WmsBatch, batch_id)
    if not batch:
        raise HTTPException(404, "batch not found")
    # 동일 source의 기존 current 해제
    siblings = (
        db.execute(select(m.WmsBatch).where(m.WmsBatch.source == batch.source)).scalars().all()
    )
    for b in siblings:
        mj = dict(b.meta_json or {})
        if mj.get("is_current"):
            mj["is_current"] = False
            b.meta_json = mj
    # 대상 배치를 current로
    mj = dict(batch.meta_json or {})
    mj["is_current"] = True
    batch.meta_json = mj
    db.commit()
    return {
        "ok": True,
        "source": batch.source,
        "current_batch_id": int(batch.id),
    }


# get current for a source (편의)
@router.get("/batches/current")
def get_current_batch(source: str = Query(...), db: Session = Depends(get_db)):
    b = _pick_current_batch_for_source(db, source)
    if not b:
        raise HTTPException(404, f"No batch for source {source}")
    return {
        "id": int(b.id),
        "source": b.source,
        "status": b.status,
        "received_at": b.received_at,
        "is_current": True if (b.meta_json or {}).get("is_current") else False,
    }


@router.post("/links/rebase")
def rebase_links(payload: dict, db: Session = Depends(get_db)):
    """
    body 예:
    {
      "std_release_id": 2,
      "source": "FP",
      "to_batch_id": 12,                 # 없으면 해당 source의 current를 사용
      "from_batch_id": 8,                # 없으면 '현재 릴리즈에서 사용 중인 이전 배치'를 추정
      "dry_run": false,
      "delete_old": true                 # 새 링크 추가 성공한 쌍만 old 링크 삭제
    }
    """
    rid = int(payload.get("std_release_id") or 0)
    source = (payload.get("source") or "").strip()
    to_bid = payload.get("to_batch_id")
    from_bid = payload.get("from_batch_id")
    dry_run = bool(payload.get("dry_run", False))
    delete_old = bool(payload.get("delete_old", False))

    if not (rid and source):
        raise HTTPException(400, "std_release_id and source are required")

    # 대상(to) 배치 결정
    if not to_bid:
        to_b = _pick_current_batch_for_source(db, source)
        if not to_b:
            raise HTTPException(404, f"No current or recent batch found for {source}")
        to_bid = int(to_b.id)
    else:
        to_b = db.get(m.WmsBatch, to_bid)
        if not to_b:
            raise HTTPException(404, f"to_batch_id {to_bid} not found")
        if to_b.source != source:
            raise HTTPException(400, f"to_batch_id {to_bid} is not for source {source}")

    # 기존(from) 배치 결정: 릴리즈가 현재 참조 중인 배치를 우선 사용
    if not from_bid:
        # 릴리즈 내 링크들이 참조하는 row의 batch_id들을 수집, 최근(최대 id) 배치 하나를 선택
        used_bids = (
            db.execute(
                select(m.WmsRow.batch_id)
                .join(m.StdWmsLink, m.StdWmsLink.wms_row_id == m.WmsRow.id)
                .join(m.WmsBatch, m.WmsBatch.id == m.WmsRow.batch_id)
                .where(
                    m.StdWmsLink.std_release_id == rid,
                    m.WmsBatch.source == source,
                )
                .group_by(m.WmsRow.batch_id)
            )
            .scalars()
            .all()
        )
        if not used_bids:
            raise HTTPException(404, "No existing links for this release/source; nothing to rebase")
        from_bid = int(sorted(used_bids)[-1])
    else:
        from_b = db.get(m.WmsBatch, from_bid)
        if not from_b:
            raise HTTPException(404, f"from_batch_id {from_bid} not found")
        if from_b.source != source:
            raise HTTPException(400, f"from_batch_id {from_bid} is not for source {source}")

    if int(from_bid) == int(to_bid):
        return {
            "release_id": rid,
            "source": source,
            "from_batch_id": int(from_bid),
            "to_batch_id": int(to_bid),
            "inserted_new_links": 0,
            "deleted_old_links": 0,
            "skipped_unmatched": 0,
            "dry_run": dry_run,
            "note": "from == to; nothing to do",
        }

    # 1) 새/옛 배치의 code → row_id 매핑 구성
    def _code_of_payload(payload: dict) -> Optional[str]:
        if not isinstance(payload, dict):
            return None
        code = payload.get("code")
        if isinstance(code, str):
            code = code.strip()
        return code or None

    new_rows = db.execute(
        select(m.WmsRow.id, m.WmsRow.payload_json)
        .join(m.WmsBatch, m.WmsBatch.id == m.WmsRow.batch_id)
        .where(m.WmsRow.batch_id == to_bid, m.WmsBatch.source == source)
    ).all()
    new_by_code: dict[str, int] = {}
    for r in new_rows:
        c = _code_of_payload(r.payload_json or {})
        if c:
            new_by_code.setdefault(c, int(r.id))

    old_rows = db.execute(
        select(m.WmsRow.id, m.WmsRow.payload_json)
        .join(m.WmsBatch, m.WmsBatch.id == m.WmsRow.batch_id)
        .where(m.WmsRow.batch_id == from_bid, m.WmsBatch.source == source)
    ).all()
    old_id_to_code: dict[int, str] = {}
    for r in old_rows:
        c = _code_of_payload(r.payload_json or {})
        if c:
            old_id_to_code[int(r.id)] = c

    if not new_by_code:
        raise HTTPException(404, f"No rows with code in to_batch_id={to_bid}")

    # 2) 릴리즈에서 '옛 배치'를 참조 중인 링크들 나열
    old_links = db.execute(
        select(m.StdWmsLink.std_node_uid, m.StdWmsLink.wms_row_id)
        .join(m.WmsRow, m.WmsRow.id == m.StdWmsLink.wms_row_id)
        .join(m.WmsBatch, m.WmsBatch.id == m.WmsRow.batch_id)
        .where(
            m.StdWmsLink.std_release_id == rid,
            m.WmsBatch.source == source,
            m.WmsRow.batch_id == from_bid,
        )
    ).all()

    if not old_links:
        return {
            "release_id": rid,
            "source": source,
            "from_batch_id": int(from_bid),
            "to_batch_id": int(to_bid),
            "inserted_new_links": 0,
            "deleted_old_links": 0,
            "skipped_unmatched": 0,
            "dry_run": dry_run,
            "note": "No old links to rebase",
        }

    # 3) 이미 존재하는 (release,node,new_row) 링크는 중복 방지
    new_row_ids = set(new_by_code.values())
    existing_new_rows = set(
        db.execute(
            select(m.StdWmsLink.std_node_uid, m.StdWmsLink.wms_row_id).where(
                m.StdWmsLink.std_release_id == rid,
                m.StdWmsLink.wms_row_id.in_(new_row_ids),
            )
        ).all()
    )
    # ✅ 진짜 튜플 셋으로 변환
    existing_new = {(row[0], int(row[1])) for row in existing_new_rows}

    to_insert: list[m.StdWmsLink] = []
    replaced_pairs: list[tuple[str, int]] = []  # (node_uid, old_row_id)
    skipped = 0

    for node_uid, old_row_id in old_links:
        code = old_id_to_code.get(int(old_row_id))
        if not code:
            skipped += 1
            continue
        new_row_id = new_by_code.get(code)
        if not new_row_id:
            skipped += 1
            continue
        key = (node_uid, int(new_row_id))
        if key in existing_new:
            # 이미 새 링크가 있으면 old 삭제만 후보에 올림
            replaced_pairs.append((node_uid, int(old_row_id)))
            continue
        to_insert.append(
            m.StdWmsLink(std_release_id=rid, std_node_uid=node_uid, wms_row_id=int(new_row_id))
        )
        replaced_pairs.append((node_uid, int(old_row_id)))

    inserted = 0
    deleted = 0

    if not dry_run and to_insert:
        db.add_all(to_insert)
        db.flush()
        inserted = len(to_insert)

    # ✅ 선택적 삭제: 새 링크가 들어간 동일 (node_uid)에서만 old 링크 제거
    if not dry_run and delete_old and replaced_pairs:
        triples = [(rid, node_uid, old_row_id) for (node_uid, old_row_id) in replaced_pairs]
        cond = sa.tuple_(
            m.StdWmsLink.std_release_id,
            m.StdWmsLink.std_node_uid,
            m.StdWmsLink.wms_row_id,
        ).in_(triples)
        res = db.execute(sa_delete(m.StdWmsLink).where(cond))
        deleted = max(res.rowcount or 0, 0)

    if not dry_run:
        db.commit()

    return {
        "release_id": rid,
        "source": source,
        "from_batch_id": int(from_bid),
        "to_batch_id": int(to_bid),
        "inserted_new_links": inserted,
        "deleted_old_links": deleted if delete_old else 0,
        "skipped_unmatched": skipped,
        "dry_run": dry_run,
    }
