from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from ..deps import get_db
from . import models as m
from . import schemas as s

router = APIRouter(prefix="/api/std", tags=["standards"])


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


@router.get("/releases/{release_id}/tree")
def get_tree(release_id: int, db: Session = Depends(get_db)):
    nodes = (
        db.query(m.StdNode)
        .filter(m.StdNode.std_release_id == release_id)
        .order_by(m.StdNode.level, m.StdNode.order_index, m.StdNode.id)
        .all()
    )
    by_uid = {
        n.std_node_uid: {
            "std_node_uid": n.std_node_uid,
            "parent_uid": n.parent_uid,
            "name": n.name,
            "level": n.level,
            "order_index": n.order_index,
            "path": n.path,
            "parent_path": n.parent_path,
            "values_json": n.values_json,
            "children": [],
        }
        for n in nodes
    }
    roots = []
    for n in nodes:
        cur = by_uid[n.std_node_uid]
        if n.parent_uid and n.parent_uid in by_uid:
            by_uid[n.parent_uid]["children"].append(cur)
        else:
            roots.append(cur)

    # 각 부모의 children 정렬
    def sort_children(d):
        d["children"].sort(key=lambda c: (c["order_index"], c["name"]))
        for c in d["children"]:
            sort_children(c)

    for r in roots:
        sort_children(r)
    return roots
