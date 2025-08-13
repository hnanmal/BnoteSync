from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import select, func, case
from sqlalchemy import delete as sa_delete
from ..deps import get_db
from . import models as m
from . import schemas as s
from fastapi import UploadFile, File, Form
from io import BytesIO
import pandas as pd
import numpy as np


router = APIRouter(prefix="/api/wms", tags=["wms"])


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


@router.get("/batches")
def list_batches(db: Session = Depends(get_db)):
    # 집계: total_rows, error_rows, ok_rows
    total = func.count(m.WmsRow.id)
    errors = func.sum(case((m.WmsRow.status == "error", 1), else_=0))
    oks = func.sum(case((m.WmsRow.status == "ok", 1), else_=0))
    q = (
        select(
            m.WmsBatch.id,
            m.WmsBatch.source,
            m.WmsBatch.status,
            m.WmsBatch.received_at,
            total.label("total_rows"),
            errors.label("error_rows"),
            oks.label("ok_rows"),
        )
        .select_from(m.WmsBatch)
        .join(m.WmsRow, m.WmsRow.batch_id == m.WmsBatch.id, isouter=True)
        .group_by(m.WmsBatch.id)
        .order_by(m.WmsBatch.id.desc())
    )
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
        }
        for r in rows
    ]


@router.get("/batches/{batch_id}/preview", response_model=list[s.WmsRowOut])
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
