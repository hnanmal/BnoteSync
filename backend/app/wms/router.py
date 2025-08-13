from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import select, func, case
from ..deps import get_db
from . import models as m
from . import schemas as s

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
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    rows = (
        db.execute(
            select(m.WmsRow)
            .where(m.WmsRow.batch_id == batch_id)
            .order_by(m.WmsRow.row_index.asc())
            .limit(limit)
            .offset(offset)
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
