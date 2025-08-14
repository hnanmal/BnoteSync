# backend/app/standards/utils.py
from typing import Optional, Tuple
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from . import models as m


def compute_path(
    db: Session,
    release_id: int,
    parent_uid: Optional[str],
    self_uid: str,
) -> Tuple[int, str, Optional[str]]:
    """
    반환: (level, path, parent_path)
    - 루트: (0, self_uid, None)
    - 자식: (parent.level+1, f"{parent.path}/{self_uid}", parent.path)
    """
    if not self_uid or "/" in self_uid:
        raise HTTPException(400, "std_node_uid is invalid")

    # 루트
    if parent_uid in (None, ""):
        return 0, self_uid, None

    if parent_uid == self_uid:
        raise HTTPException(400, "parent_uid cannot be self")

    parent = db.scalar(
        select(m.StdNode).where(
            m.StdNode.std_release_id == release_id, m.StdNode.std_node_uid == parent_uid
        )
    )
    if not parent:
        raise HTTPException(400, "parent_uid not found in this release")

    return parent.level + 1, f"{parent.path}/{self_uid}", parent.path


def ensure_no_cycle(
    db: Session, release_id: int, node_path: str, new_parent_uid: Optional[str]
) -> None:
    """부모 변경 시 사이클 방지: 새 부모가 내 후손이면 금지"""
    if not new_parent_uid:
        return
    parent = db.scalar(
        select(m.StdNode).where(
            m.StdNode.std_release_id == release_id, m.StdNode.std_node_uid == new_parent_uid
        )
    )
    if not parent:
        raise HTTPException(400, "parent_uid not found in this release")
    if parent.path == node_path or parent.path.startswith(f"{node_path}/"):
        raise HTTPException(400, "Cannot reparent to a descendant (cycle)")


def reparent_and_recompute(
    db: Session,
    release_id: int,
    node: m.StdNode,
    new_parent_uid: Optional[str],
) -> None:
    """부모를 바꾸고 자신+후손의 level/path/parent_path 갱신"""
    ensure_no_cycle(db, release_id, node.path, new_parent_uid)

    old_path = node.path
    old_level = node.level

    new_level, new_path, new_parent_path = compute_path(
        db, release_id, new_parent_uid, node.std_node_uid
    )

    # 자신 업데이트
    node.parent_uid = new_parent_uid
    node.level = new_level
    node.path = new_path
    node.parent_path = new_parent_path

    # 후손 일괄 갱신
    descendants = db.scalars(
        select(m.StdNode).where(
            m.StdNode.std_release_id == release_id, m.StdNode.path.like(f"{old_path}/%")
        )
    ).all()

    level_delta = new_level - old_level
    for d in descendants:
        suffix = d.path[len(old_path) :]  # "/xxx/yyy"
        d.path = f"{new_path}{suffix}"
        d.level = d.level + level_delta
        d.parent_path = d.path.rsplit("/", 1)[0] if "/" in d.path else None
