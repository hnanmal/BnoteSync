# backend/app/standards/router.py

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session
from ..deps import get_db
from . import models as m
from . import schemas as s
from .utils import compute_path, reparent_and_recompute

router = APIRouter(prefix="/api/std", tags=["standards"])


# standards/router.py (발췌)
@router.post("/releases/{rid}/nodes", response_model=s.StdNodeOut)
def create_node(rid: int, payload: s.StdNodeCreate, db: Session = Depends(get_db)):
    rel = db.scalar(select(m.StdRelease).where(m.StdRelease.id == rid))
    if not rel:
        raise HTTPException(404, "Release not found")

    # level/path 계산 (필요시)
    level, path, parent_path = compute_path(db, rid, payload.parent_uid, payload.std_node_uid)

    node = m.StdNode(
        std_release_id=rid,  # ✅ 당신의 모델에 맞춤
        std_node_uid=payload.std_node_uid,
        parent_uid=payload.parent_uid,
        name=payload.name,
        level=level,
        order_index=payload.order_index or 0,
        path=path,
        parent_path=parent_path,
        values_json=payload.values_json,
    )

    db.add(node)
    db.commit()  # ✅ 여기서 커밋
    db.refresh(node)
    return node


@router.patch("/releases/{rid}/nodes/{uid}", response_model=s.StdNodeOut)
def update_node(rid: int, uid: str, payload: s.StdNodeUpdate, db: Session = Depends(get_db)):
    node = db.scalar(
        select(m.StdNode).where(m.StdNode.std_release_id == rid, m.StdNode.std_node_uid == uid)
    )
    if not node:
        raise HTTPException(404, "Node not found")

    if payload.name is not None:
        node.name = payload.name
    if payload.order_index is not None:
        node.order_index = payload.order_index
    if payload.parent_uid is not None and payload.parent_uid != node.parent_uid:
        level, path, parent_path = compute_path(db, rid, payload.parent_uid, node.std_node_uid)
        node.parent_uid = payload.parent_uid
        node.level = level
        node.path = path
        node.parent_path = parent_path
        # TODO: 자식 서브트리 재계산

    db.commit()  # ✅ 커밋
    db.refresh(node)
    return node


@router.delete("/releases/{rid}/nodes/{uid}", status_code=204)
def delete_node(rid: int, uid: str, db: Session = Depends(get_db)):
    # 1) 대상 노드 조회
    node = db.scalar(
        select(m.StdNode).where(m.StdNode.std_release_id == rid, m.StdNode.std_node_uid == uid)
    )
    if not node:
        raise HTTPException(404, "Node not found")

    base_path = node.path  # 예: "EARTH/EXCAVATION"

    # 2) 본인 + 모든 후손 삭제 (트랜잭션 컨텍스트 쓰지 말고 단일 커밋)
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
    return db.query(m.StdRelease).order_by(m.StdRelease.id.desc()).all()


@router.post("/releases", response_model=s.StdReleaseOut)
def create_release(payload: s.StdReleaseCreate, db: Session = Depends(get_db)):
    exists = db.query(m.StdRelease).filter(m.StdRelease.version == payload.version).first()
    if exists:
        raise HTTPException(status_code=409, detail="version already exists")
    rel = m.StdRelease(version=payload.version)
    db.add(rel)
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
            rel = m.StdRelease(version=version)
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
                ),
                dict(
                    std_node_uid="EXCAVATION",
                    parent_uid="EARTH",
                    name="Excavation",
                    level=1,
                    order_index=0,
                    path="EARTH/EXCAVATION",
                    parent_path="EARTH",
                ),
                dict(
                    std_node_uid="MANUAL_ABOVE_GWL",
                    parent_uid="EXCAVATION",
                    name="Manual Excavation Above GWL",
                    level=2,
                    order_index=0,
                    path="EARTH/EXCAVATION/MANUAL_ABOVE_GWL",
                    parent_path="EARTH/EXCAVATION",
                ),
                dict(
                    std_node_uid="MANUAL_BELOW_GWL",
                    parent_uid="EXCAVATION",
                    name="Manual Excavation Below GWL",
                    level=2,
                    order_index=1,
                    path="EARTH/EXCAVATION/MANUAL_BELOW_GWL",
                    parent_path="EARTH/EXCAVATION",
                ),
            ]
            for n in nodes:
                db.add(m.StdNode(std_release_id=rel.id, **n))
        db.commit()  # ✅ 명시적 커밋
        return {"id": rel.id, "version": rel.version}
    except Exception as e:
        # 콘솔에도 스택 출력
        import traceback

        traceback.print_exc()
        # 클라이언트에 에러 원인 노출 (임시)
        raise HTTPException(status_code=500, detail=f"{type(e).__name__}: {e}")


@router.get("/releases/{rid}/tree", response_model=dict[str, list[s.StdNodeTreeOut]])
def get_tree(rid: int, db: Session = Depends(get_db)):
    # ✅ 새 컬럼명으로 필터하고, 정렬은 level → order_index → uid
    rows = db.scalars(
        select(m.StdNode)
        .where(m.StdNode.std_release_id == rid)  # ← 여기!
        .order_by(m.StdNode.level, m.StdNode.order_index, m.StdNode.std_node_uid)
    ).all()

    # 행 → 트리 노드로 변환
    def to_node(row: m.StdNode) -> s.StdNodeTreeOut:
        return s.StdNodeTreeOut(
            std_node_uid=row.std_node_uid,
            parent_uid=row.parent_uid,
            name=row.name,
            level=row.level,
            order_index=row.order_index,
            path=row.path,
            parent_path=row.parent_path,
            values_json=row.values_json,
            children=[],  # 트리 빌드 시 채움
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
                # 부모가 아직 없으면 생성해 두고 나중에 덮어씀(안전용)
                # 실제로는 정렬 때문에 거의 먼저 만들어짐
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
                        children=[],
                    )
                )
                by_uid[r.parent_uid] = parent
            parent.children.append(node)
        else:
            roots.append(node)

    # 프런트는 root.children을 사용하니 간단히 래핑해서 반환
    return {"children": roots}
