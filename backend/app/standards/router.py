# backend/app/standards/router.py

from typing import Literal, Optional
from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy import delete, or_, select, text
from sqlalchemy.orm import Session
import sqlalchemy as sa  # ⭐ INSERT ... SELECT 등 사용
from ..deps import get_db
from . import models as m
from . import schemas as s
from .utils import compute_path, reparent_and_recompute

router = APIRouter(prefix="/api/std", tags=["standards"])


def infer_kind_from_release(rel: m.StdRelease) -> m.StdKind:
    """릴리즈 버전 접두어로 GWM/SWM 추정 (예: 'SWM-2025.08' → SWM)"""
    v = (rel.version or "").upper()
    return m.StdKind.SWM if v.startswith("SWM") else m.StdKind.GWM


# ⭐ DRAFT 상태에서만 편집 허용
def ensure_draft(rel: m.StdRelease):
    if rel.status != m.ReleaseStatus.DRAFT:
        raise HTTPException(
            status_code=409,
            detail=f"Release {rel.version} is {rel.status}; only DRAFT is editable.",
        )


@router.post("/releases/{rid}/nodes", response_model=s.StdNodeOut)
def create_node(
    rid: int,
    payload: s.StdNodeCreate,
    db: Session = Depends(get_db),
    kind: m.StdKind | None = Query(None, description="루트 생성 시 지정(GWM|SWM)"),
):
    rel = db.scalar(select(m.StdRelease).where(m.StdRelease.id == rid))
    if not rel:
        raise HTTPException(404, "Release not found")
    ensure_draft(rel)  # ⭐ 가드

    # level/path 계산
    level, path, parent_path = compute_path(db, rid, payload.parent_uid, payload.std_node_uid)

    # std_kind 결정
    if payload.parent_uid:
        parent = db.scalar(
            select(m.StdNode).where(
                m.StdNode.std_release_id == rid,
                m.StdNode.std_node_uid == payload.parent_uid,
            )
        )
        if not parent:
            raise HTTPException(404, "Parent not found")
        std_kind = parent.std_kind  # 부모와 동일
    else:
        # 루트: payload.std_kind → query kind → 릴리즈 버전 추정
        std_kind = getattr(payload, "std_kind", None) or kind or infer_kind_from_release(rel)

    node = m.StdNode(
        std_release_id=rid,
        std_node_uid=payload.std_node_uid,
        parent_uid=payload.parent_uid,
        name=payload.name,
        level=level,
        order_index=payload.order_index or 0,
        path=path,
        parent_path=parent_path,
        values_json=payload.values_json,
        std_kind=std_kind,
    )

    db.add(node)
    db.commit()
    db.refresh(node)
    return node


@router.patch("/releases/{rid}/nodes/{uid}", response_model=s.StdNodeOut)
def update_node(
    rid: int,
    uid: str,
    payload: s.StdNodeUpdate,
    db: Session = Depends(get_db),
):
    rel = db.scalar(select(m.StdRelease).where(m.StdRelease.id == rid))
    if not rel:
        raise HTTPException(404, "Release not found")
    ensure_draft(rel)  # ⭐ 가드

    node = db.scalar(
        select(m.StdNode).where(m.StdNode.std_release_id == rid, m.StdNode.std_node_uid == uid)
    )
    if not node:
        raise HTTPException(404, "Node not found")

    if payload.name is not None:
        node.name = payload.name
    if payload.order_index is not None:
        node.order_index = payload.order_index

    # 부모 변경 시: 경로 재계산 + cross-kind 금지
    if payload.parent_uid is not None and payload.parent_uid != node.parent_uid:
        if payload.parent_uid:
            parent = db.scalar(
                select(m.StdNode).where(
                    m.StdNode.std_release_id == rid,
                    m.StdNode.std_node_uid == payload.parent_uid,
                )
            )
            if not parent:
                raise HTTPException(404, "Parent not found")
            if parent.std_kind != node.std_kind:
                raise HTTPException(400, "Cannot move node across different std_kind (GWM/SWM)")
        level, path, parent_path = compute_path(db, rid, payload.parent_uid, node.std_node_uid)
        node.parent_uid = payload.parent_uid
        node.level = level
        node.path = path
        node.parent_path = parent_path
        # TODO: 자식 서브트리 재계산 (reparent_and_recompute 활용 가능)

    db.commit()
    db.refresh(node)
    return node


@router.delete("/releases/{rid}/nodes/{uid}", status_code=204)
def delete_node(rid: int, uid: str, db: Session = Depends(get_db)):
    rel = db.scalar(select(m.StdRelease).where(m.StdRelease.id == rid))
    if not rel:
        raise HTTPException(404, "Release not found")
    ensure_draft(rel)  # ⭐ 가드

    node = db.scalar(
        select(m.StdNode).where(m.StdNode.std_release_id == rid, m.StdNode.std_node_uid == uid)
    )
    if not node:
        raise HTTPException(404, "Node not found")

    base_path = node.path
    db.execute(
        delete(m.StdNode).where(
            m.StdNode.std_release_id == rid,
            or_(m.StdNode.path == base_path, m.StdNode.path.like(f"{base_path}/%")),
        )
    )
    db.commit()
    return


@router.get("/releases", response_model=list[s.StdReleaseOut])
def list_releases(db: Session = Depends(get_db)):
    # 상태(status) 포함 응답 (schemas.StdReleaseOut 에 status 필드가 있어야 함)
    return db.query(m.StdRelease).order_by(m.StdRelease.id.desc()).all()


@router.post("/releases", response_model=s.StdReleaseOut)
def create_release(payload: s.StdReleaseCreate, db: Session = Depends(get_db)):
    exists = db.query(m.StdRelease).filter(m.StdRelease.version == payload.version).first()
    if exists:
        raise HTTPException(status_code=409, detail="version already exists")
    rel = m.StdRelease(version=payload.version)  # status는 모델 default=DRAFT
    db.add(rel)
    db.commit()
    db.refresh(rel)
    return rel


# ⭐ 새 드래프트(복제) 엔드포인트
# ... 파일 상단/중앙부는 동일 ...


@router.post("/releases/{rid}/clone", response_model=s.StdReleaseOut)
def clone_release(rid: int, payload: s.StdReleaseCloneIn, db: Session = Depends(get_db)):
    base = db.scalar(select(m.StdRelease).where(m.StdRelease.id == rid))
    if not base:
        raise HTTPException(404, "Base release not found")

    # 버전 유니크
    exists = db.scalar(select(m.StdRelease).where(m.StdRelease.version == payload.version))
    if exists:
        raise HTTPException(409, "version already exists")

    # 새 릴리즈 (항상 DRAFT)
    new_rel = m.StdRelease(version=payload.version, status=m.ReleaseStatus.DRAFT)
    db.add(new_rel)
    db.flush()  # new_rel.id 확보

    # std_nodes 복제 (INSERT ... SELECT)
    cols = [
        "std_release_id",
        "std_node_uid",
        "parent_uid",
        "name",
        "level",
        "order_index",
        "path",
        "parent_path",
        "values_json",
        "std_kind",
    ]
    sel = sa.select(
        sa.literal(new_rel.id).label("std_release_id"),
        m.StdNode.std_node_uid,
        m.StdNode.parent_uid,
        m.StdNode.name,
        m.StdNode.level,
        m.StdNode.order_index,
        m.StdNode.path,
        m.StdNode.parent_path,
        m.StdNode.values_json,
        m.StdNode.std_kind,
    ).where(m.StdNode.std_release_id == rid)
    db.execute(sa.insert(m.StdNode).from_select(cols, sel))

    # (선택) 링크 복제: std_wms_link (안티조인으로 중복 방지)
    if payload.copy_links:
        sql = text(
            """
            INSERT INTO std_wms_link (std_release_id, std_node_uid, wms_row_id)
            SELECT :to_rid, src.std_node_uid, src.wms_row_id
            FROM std_wms_link AS src
            LEFT JOIN std_wms_link AS dst
              ON dst.std_release_id = :to_rid
             AND dst.std_node_uid   = src.std_node_uid
             AND dst.wms_row_id     = src.wms_row_id
            WHERE src.std_release_id = :from_rid
              AND dst.std_release_id IS NULL
            """
        )
        db.execute(sql, {"to_rid": new_rel.id, "from_rid": rid})

    db.commit()
    db.refresh(new_rel)
    return new_rel


# @router.post("/releases/{rid}/clone", response_model=s.StdReleaseOut)
# def clone_release(rid: int, payload: s.StdReleaseCloneIn, db: Session = Depends(get_db)):
#     base = db.scalar(select(m.StdRelease).where(m.StdRelease.id == rid))
#     if not base:
#         raise HTTPException(404, "Base release not found")

#     # 버전 유니크
#     exists = db.scalar(select(m.StdRelease).where(m.StdRelease.version == payload.version))
#     if exists:
#         raise HTTPException(409, "version already exists")

#     # 새 릴리즈 (항상 DRAFT)
#     new_rel = m.StdRelease(version=payload.version, status=m.ReleaseStatus.DRAFT)
#     db.add(new_rel)
#     db.flush()  # new_rel.id 확보

#     # std_nodes 복제 (INSERT ... SELECT)
#     cols = [
#         "std_release_id",
#         "std_node_uid",
#         "parent_uid",
#         "name",
#         "level",
#         "order_index",
#         "path",
#         "parent_path",
#         "values_json",
#         "std_kind",
#     ]
#     sel = sa.select(
#         sa.literal(new_rel.id).label("std_release_id"),
#         m.StdNode.std_node_uid,
#         m.StdNode.parent_uid,
#         m.StdNode.name,
#         m.StdNode.level,
#         m.StdNode.order_index,
#         m.StdNode.path,
#         m.StdNode.parent_path,
#         m.StdNode.values_json,
#         m.StdNode.std_kind,
#     ).where(m.StdNode.std_release_id == rid)
#     db.execute(sa.insert(m.StdNode).from_select(cols, sel))

#     # (선택) wms_links 복제: 존재 시에만 진행
#     if payload.copy_links:
#         try:
#             from ..wms import models as wm

#             link_cols = ["std_release_id", "std_node_uid", "row_id"]
#             link_sel = sa.select(
#                 sa.literal(new_rel.id).label("std_release_id"),
#                 wm.WmsLink.std_node_uid,
#                 wm.WmsLink.row_id,
#             ).where(wm.WmsLink.std_release_id == rid)
#             db.execute(sa.insert(wm.WmsLink).from_select(link_cols, link_sel))
#         except Exception:
#             # wms_links 모델이 없거나 스키마가 다르면 무시하고 진행
#             pass

#     db.commit()
#     db.refresh(new_rel)
#     return new_rel


# ⭐ 릴리즈 상태 변경
@router.patch("/releases/{rid}/status", response_model=s.StdReleaseOut)
def set_release_status(rid: int, payload: s.StdReleaseStatusIn, db: Session = Depends(get_db)):
    rel = db.scalar(select(m.StdRelease).where(m.StdRelease.id == rid))
    if not rel:
        raise HTTPException(404, "Release not found")

    # 전이 규칙이 필요하면 여기에 추가 (예: DRAFT -> ACTIVE만 허용 등)
    rel.status = m.ReleaseStatus(payload.status.value)
    db.commit()
    db.refresh(rel)
    return rel


@router.post("/dev/seed-demo")
def seed_demo(db: Session = Depends(get_db)):
    try:
        version = "std-001"
        rel = db.execute(
            select(m.StdRelease).where(m.StdRelease.version == version)
        ).scalar_one_or_none()
        if not rel:
            rel = m.StdRelease(version=version)  # status=DRAFT
            db.add(rel)
            db.flush()  # rel.id 확보

            nodes = [
                dict(
                    std_node_uid="EARTH",
                    parent_uid=None,
                    name="Earth Work",
                    level=0,
                    order_index=0,
                    path="EARTH",
                    parent_path=None,
                    std_kind=m.StdKind.GWM,
                ),
                dict(
                    std_node_uid="EXCAVATION",
                    parent_uid="EARTH",
                    name="Excavation",
                    level=1,
                    order_index=0,
                    path="EARTH/EXCAVATION",
                    parent_path="EARTH",
                    std_kind=m.StdKind.GWM,
                ),
                dict(
                    std_node_uid="MANUAL_ABOVE_GWL",
                    parent_uid="EXCAVATION",
                    name="Manual Excavation Above GWL",
                    level=2,
                    order_index=0,
                    path="EARTH/EXCAVATION/MANUAL_ABOVE_GWL",
                    parent_path="EARTH/EXCAVATION",
                    std_kind=m.StdKind.GWM,
                ),
                dict(
                    std_node_uid="MANUAL_BELOW_GWL",
                    parent_uid="EXCAVATION",
                    name="Manual Excavation Below GWL",
                    level=2,
                    order_index=1,
                    path="EARTH/EXCAVATION/MANUAL_BELOW_GWL",
                    parent_path="EARTH/EXCAVATION",
                    std_kind=m.StdKind.GWM,
                ),
            ]
            for n in nodes:
                db.add(m.StdNode(std_release_id=rel.id, **n))
        db.commit()
        return {"id": rel.id, "version": rel.version}
    except Exception as e:
        import traceback

        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"{type(e).__name__}: {e}")


@router.get("/releases/{rid}/tree", response_model=dict[str, list[s.StdNodeTreeOut]])
def get_tree(
    rid: int,
    db: Session = Depends(get_db),
    kind: m.StdKind = Query(..., description="GWM or SWM"),
):
    # kind 필터 + 정렬
    rows = db.scalars(
        select(m.StdNode)
        .where(
            m.StdNode.std_release_id == rid,
            m.StdNode.std_kind == kind,
        )
        .order_by(m.StdNode.level, m.StdNode.order_index, m.StdNode.std_node_uid)
    ).all()

    # 행 → 트리 노드로 변환
    def to_node(row: m.StdNode) -> s.StdNodeTreeOut:
        std_kind_val = row.std_kind.value if hasattr(row.std_kind, "value") else row.std_kind
        return s.StdNodeTreeOut(
            std_node_uid=row.std_node_uid,
            parent_uid=row.parent_uid,
            name=row.name,
            level=row.level,
            order_index=row.order_index,
            path=row.path,
            parent_path=row.parent_path,
            values_json=row.values_json,
            std_kind=std_kind_val,
            children=[],
        )

    by_uid: dict[str, s.StdNodeTreeOut] = {}
    roots: list[s.StdNodeTreeOut] = []

    for r in rows:
        node = by_uid.get(r.std_node_uid)
        if node is None:
            node = to_node(r)
            by_uid[r.std_node_uid] = node

        if r.parent_uid:
            parent = by_uid.get(r.parent_uid)
            if parent is None:
                parent_row = next((x for x in rows if x.std_node_uid == r.parent_uid), None)
                parent = (
                    to_node(parent_row)
                    if parent_row
                    else s.StdNodeTreeOut(
                        std_node_uid=r.parent_uid,
                        parent_uid=None,
                        name=r.parent_uid,
                        level=max(r.level - 1, 0),
                        order_index=0,
                        path="",
                        parent_path=None,
                        values_json=None,
                        std_kind=(
                            r.std_kind.value if hasattr(r.std_kind, "value") else r.std_kind
                        ),  # 부모 프록시도 채움
                        children=[],
                    )
                )
                by_uid[r.parent_uid] = parent
            parent.children.append(node)
        else:
            roots.append(node)

    return {"children": roots}


@router.post("/releases/{to_rid}/links/copy-from/{from_rid}")
def copy_links_from_release(to_rid: int, from_rid: int, db: Session = Depends(get_db)):
    # 대상 릴리즈는 DRAFT만 허용
    to_rel = db.scalar(select(m.StdRelease).where(m.StdRelease.id == to_rid))
    if not to_rel:
        raise HTTPException(404, "Target release not found")
    if to_rel.status != m.ReleaseStatus.DRAFT:
        raise HTTPException(
            409,
            f"Target release {to_rel.version} is {to_rel.status}; only DRAFT can receive links.",
        )

    # 존재하지 않는 링크만 안전하게 복사(anti-join)
    sql = text(
        """
    INSERT INTO std_wms_link (std_release_id, std_node_uid, wms_row_id)
    SELECT :to_rid, src.std_node_uid, src.wms_row_id
    FROM std_wms_link AS src
    LEFT JOIN std_wms_link AS dst
    ON dst.std_release_id = :to_rid
    AND dst.std_node_uid  = src.std_node_uid
    AND dst.wms_row_id        = src.wms_row_id
    WHERE src.std_release_id = :from_rid
    AND dst.std_release_id IS NULL
    """
    )
    res = db.execute(sql, {"to_rid": to_rid, "from_rid": from_rid})
    db.commit()
    # 일부 드라이버에서 rowcount가 -1일 수 있으니 0 이상만 신뢰
    copied = res.rowcount if (res.rowcount or 0) > 0 else 0
    return {"copied": copied, "to_rid": to_rid, "from_rid": from_rid}


@router.post("/releases/{to_rid}/links/copy")
def copy_links(
    to_rid: int,
    payload: dict = Body(...),
    db: Session = Depends(get_db),
):
    """
    payload 예:
    {
      "from_rid": 1,                          # or
      "from_version": "GWM-2025.08",          # or
      "from": "latest_active",                # "latest_active" 지원
      "only_existing_nodes": true             # 대상 릴리즈에 존재하는 노드만 복사(권장)
    }
    """
    to_rel = db.scalar(select(m.StdRelease).where(m.StdRelease.id == to_rid))
    if not to_rel:
        raise HTTPException(404, "Target release not found")
    if to_rel.status != m.ReleaseStatus.DRAFT:
        raise HTTPException(
            409,
            f"Target release {to_rel.version} is {to_rel.status}; only DRAFT can receive links.",
        )

    from_rid: Optional[int] = payload.get("from_rid")
    from_version: Optional[str] = payload.get("from_version")
    from_flag: Optional[Literal["latest_active"]] = payload.get("from")
    only_existing_nodes: bool = bool(payload.get("only_existing_nodes", True))

    # 1) source release 결정
    src_rel = None
    if from_rid:
        src_rel = db.scalar(select(m.StdRelease).where(m.StdRelease.id == from_rid))
    elif from_version:
        src_rel = db.scalar(select(m.StdRelease).where(m.StdRelease.version == from_version))
    elif from_flag == "latest_active":
        # to_rid 이전 중 가장 최근 ACTIVE 우선, 없으면 전체 중 최신 ACTIVE
        src_rel = db.scalar(
            select(m.StdRelease)
            .where(m.StdRelease.status == m.ReleaseStatus.ACTIVE, m.StdRelease.id < to_rid)
            .order_by(m.StdRelease.id.desc())
        ) or db.scalar(
            select(m.StdRelease)
            .where(m.StdRelease.status == m.ReleaseStatus.ACTIVE)
            .order_by(m.StdRelease.id.desc())
        )
    else:
        raise HTTPException(400, "Provide one of: from_rid, from_version, or from='latest_active'.")

    if not src_rel:
        raise HTTPException(404, "Source release not found")

    # 2) 복사 SQL (테이블: std_wms_link, 키: wms_row_id) — 중복 방지 anti-join
    if only_existing_nodes:
        sql = text(
            """
        INSERT INTO std_wms_link (std_release_id, std_node_uid, wms_row_id)
        SELECT :to_rid, src.std_node_uid, src.wms_row_id
        FROM std_wms_link AS src
        JOIN std_nodes AS n
          ON n.std_release_id = :to_rid
         AND n.std_node_uid   = src.std_node_uid
        LEFT JOIN std_wms_link AS dst
          ON dst.std_release_id = :to_rid
         AND dst.std_node_uid  = src.std_node_uid
         AND dst.wms_row_id    = src.wms_row_id
        WHERE src.std_release_id = :from_rid
          AND dst.std_release_id IS NULL
        """
        )
    else:
        sql = text(
            """
        INSERT INTO std_wms_link (std_release_id, std_node_uid, wms_row_id)
        SELECT :to_rid, src.std_node_uid, src.wms_row_id
        FROM std_wms_link AS src
        LEFT JOIN std_wms_link AS dst
          ON dst.std_release_id = :to_rid
         AND dst.std_node_uid  = src.std_node_uid
         AND dst.wms_row_id    = src.wms_row_id
        WHERE src.std_release_id = :from_rid
          AND dst.std_release_id IS NULL
        """
        )

    res = db.execute(sql, {"to_rid": to_rid, "from_rid": src_rel.id})
    db.commit()
    copied = res.rowcount or 0
    return {
        "copied": max(copied, 0),
        "to_release": {"id": to_rid, "version": to_rel.version, "status": to_rel.status.value},
        "from_release": {
            "id": src_rel.id,
            "version": src_rel.version,
            "status": src_rel.status.value,
        },
        "only_existing_nodes": only_existing_nodes,
    }
