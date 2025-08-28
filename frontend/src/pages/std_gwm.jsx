import { useEffect, useMemo, useState, useTransition, useRef } from "react";
import { useQuery, useMutation, useQueryClient, useQueries } from "@tanstack/react-query";
import {
  listStdReleases, getStdTree, createStdNode, updateStdNode, deleteStdNode, cloneRelease, setReleaseStatus,copyLinksFromRelease,
} from "../shared/api/std";
import {
  listWmsItems, listLinks, assignLinks, unassignLinks, listBatches
} from "../shared/api/wms";
import { buildOrderedRawColumns, normalizeLabel } from "../shared/api/columnOrder";
import { useResizableColumns, ResizableTH, ResizableColgroup } from "../shared/ui/resizableColumns";

// uid -> { node, parentUid } 매핑 생성
function buildParentIndexFromChildren(rootChildren) {
  const map = new Map();
  const dfs = (node, parentUid = null) => {
    map.set(node.std_node_uid, { node, parentUid });
    (node.children ?? []).forEach(ch => dfs(ch, node.std_node_uid));
  };
  (rootChildren ?? []).forEach(r => dfs(r, null));
  return map;
}

// 선택 uid에서 루트까지 경로 배열 [root, ..., selected]
function buildPath(uid, parentIndex) {
  if (!uid || !parentIndex.size) return [];
  const path = [];
  let cur = uid, hop = 0;
  const GUARD = 10_000;
  while (cur != null && hop < GUARD) {
    const ent = parentIndex.get(cur);
    if (!ent) break;
    path.push(ent.node);
    cur = ent.parentUid ?? null;
    hop++;
  }
  return path.reverse();
}

function CompactBreadcrumb({ path, onJump }) {
  const items = useMemo(() => {
    if (!path?.length) return [];
    if (path.length <= 3) return path.map(p => ({ type:"node", node:p }));
    return [
      { type:"node", node: path[0] },
      { type:"ellipsis" },
      ...path.slice(-2).map(p => ({ type:"node", node:p })),
    ];
  }, [path]);

  if (!items.length) {
    return <div className="text-xs text-gray-400 whitespace-nowrap">경로 없음</div>;
  }

  return (
    <nav className="flex-1 min-w-0 overflow-hidden">
      {/* ⭐ 글씨 크기 고정: md:text-lg (기존 md:text-md 오타 수정) */}
      <ol className="flex items-center gap-1 text-base md:text-lg whitespace-nowrap overflow-hidden">
        {items.map((it, idx) => {
          const isLast = idx === items.length - 1;
          if (it.type === "ellipsis") {
            return <span key={`e-${idx}`} className="text-gray-400">…</span>;
          }
          const n = it.node;
          return (
            <span key={n.std_node_uid} className="flex items-center gap-1 min-w-0">
              <button
                type="button"
                disabled={isLast}
                onClick={() => !isLast && onJump(n.std_node_uid)}
                title={n.name}
                className={
                  "max-w-[220px] truncate px-2 py-1 rounded " +
                  (isLast ? "bg-gray-100 text-gray-800 cursor-default"
                          : "text-blue-600 hover:bg-gray-100")
                }
              >
                {n.name || "(no name)"}
              </button>
              {!isLast && <span className="text-gray-400">›</span>}
            </span>
          );
        })}
      </ol>
    </nav>
  );
}

function TreeNode({ node, onSelect, selectedUid, onAddChild, onRename, onDelete, canEdit }) {
  const hasChildren = (node.children ?? []).length > 0;
  const isSel = selectedUid === node.std_node_uid;
  return (
    <div className="pl-2">
      <div
        className={`flex items-center gap-2 py-0.5 rounded ${isSel ? "bg-blue-50" : "hover:bg-gray-50"}`}
        aria-selected={isSel}
      >
        <button
          className={`text-left flex-1 truncate px-1 focus:outline-none focus:ring-2 focus:ring-blue-300
            ${isSel ? "font-semibold text-blue-700" : "text-gray-800"}`}
          onClick={() => onSelect(node)}
          title={node.path}
        >
          {node.name}
        </button>
        <button className="text-xs px-2 py-0.5 border rounded disabled:opacity-50"
                disabled={!canEdit} onClick={() => onAddChild(node)}>＋</button>
        <button className="text-xs px-2 py-0.5 border rounded disabled:opacity-50"
                disabled={!canEdit} onClick={() => onRename(node)}>✎</button>
        <button className="text-xs px-2 py-0.5 border rounded text-red-600 disabled:opacity-50"
                disabled={!canEdit} onClick={() => onDelete(node)}>🗑</button>
        {/* <button className="text-xs px-2 py-0.5 border rounded" onClick={() => onAddChild(node)}>＋</button>
        <button className="text-xs px-2 py-0.5 border rounded" onClick={() => onRename(node)}>✎</button>
        <button className="text-xs px-2 py-0.5 border rounded text-red-600" onClick={() => onDelete(node)}>🗑</button> */}
      </div>
      {hasChildren && (
        <div className="pl-3 border-l">
          {node.children.map((ch) => (
            <TreeNode key={ch.std_node_uid}
              node={ch}
              selectedUid={selectedUid}
              onSelect={onSelect}
              onAddChild={onAddChild}
              onRename={onRename}
              onDelete={onDelete}
              canEdit={canEdit}   // ✅ 재귀에도 전달
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function StdGwmPage() {
  const KIND = "GWM"; // ⭐ 이 페이지는 GWM 전용
  const qc = useQueryClient();
  const [rid, setRid] = useState(null);
  const [releaseStatus, setReleaseStatusLocal] = useState("DRAFT");
  const isDraft = releaseStatus === "DRAFT";
  const [selectedNode, setSelectedNode] = useState(null);
  const [sources, setSources] = useState(["AR","FP","SS"]);
  const [searchDraft, setSearchDraft] = useState("");
  const [searchApplied, setSearchApplied] = useState("");
  const isComposing = useRef(false);
  const applySearch = () => setSearchApplied(searchDraft.trim());
  const singleSource = sources.length === 1 ? sources[0] : null;
  const [selectedBatchId, setSelectedBatchId] = useState(null);
  // ▼ 소스별 선택 배치 상태
  const [selectedBatches, setSelectedBatches] = useState({ AR: null, FP: null, SS: null });
  const [selRowIds, setSelRowIds] = useState(new Set());
  const [selLinkIds, setSelLinkIds] = useState(new Set());
  const [pageSize, setPageSize] = useState(200);
  const [order, setOrder] = useState("asc");
  
  useEffect(() => { setSelectedBatchId(null); }, [singleSource]); // 소스 바뀌면 초기화

  // 소스 체크 변화 시, 선택 상태에서 없는 소스 키는 제거
  useEffect(() => {
    setSelectedBatches(prev => {
      const next = {};
      (sources || []).forEach(s => { next[s] = prev[s] ?? null; });
      return next;
    });
  }, [sources]);

  useEffect(() => {
    setSelectedNode(null);
    setSelRowIds(new Set());
  }, [rid]);

  // Releases
  const relQ = useQuery({
    queryKey: ["std","releases"],
    queryFn: listStdReleases,
    onSuccess: (data) => {
      if (!Number.isFinite(rid) && data?.length) {
        const first = Number(data[0].id);
        setRid(Number.isFinite(first) ? first : null);
      }
      // 선택 릴리즈 상태 동기화
      if (Number.isFinite(rid)) {
        const found = data?.find(r => Number(r.id) === Number(rid));
        if (found) setReleaseStatusLocal(found.status || "DRAFT");
      }
    }
  });

  // rid 변경 시 상태 재반영
  useEffect(() => {
    if (!relQ.data) return;
    const found = relQ.data.find(r => Number(r.id) === Number(rid));
    if (found) setReleaseStatusLocal(found.status || "DRAFT");
  }, [rid, relQ.data]);

  // Tree (⭐ kind 포함)
  const treeQ = useQuery({
    enabled: !!rid,
    queryKey: ["std","tree",rid,KIND],        // ⭐ 캐시 키에 KIND 포함
    queryFn: () => getStdTree(rid, { kind: KIND }) // ⭐ 서버에 kind=GWM 전달
  });

  const parentIndex = useMemo(() => {
    return buildParentIndexFromChildren(treeQ.data?.children ?? []);
  }, [treeQ.data]);

  const breadcrumbPath = useMemo(() => {
    return buildPath(selectedNode?.std_node_uid, parentIndex);
  }, [selectedNode?.std_node_uid, parentIndex]);

  const jumpToUid = (uid) => {
    const entry = parentIndex.get(uid);
    if (entry?.node) setSelectedNode(entry.node);
  };

  const selectedDepth = useMemo(() => {
    if (!selectedNode) return null;
    let depth = 0;
    let cur = selectedNode.std_node_uid;
    while (cur != null) {
      const entry = parentIndex.get(cur);
      if (!entry) break;
      depth++;
      cur = entry.parentUid;
    }
    return depth;
  }, [selectedNode, parentIndex]);

  const isLevel2 = selectedDepth === 3;

  // 소스별 배치 목록 fetch
  const batchQueries = useQueries({
    queries: (sources || []).map(src => ({
      queryKey: ["wms","batches", src],
      enabled: true,
      queryFn: () => listBatches({ source: src, limit: 50 }),
    })),
  });
  // 소스 → 배치목록 매핑
  const batchesBySource = useMemo(() => {
    const map = {};
    (sources || []).forEach((s, i) => { map[s] = batchQueries[i]?.data || []; });
    return map;
  }, [sources, batchQueries]);

  // 선택된 배치들의 합집합 → API에 넘길 값
  const selectedBatchIds = useMemo(() =>
    Object.values(selectedBatches || {}).filter(v => Number.isFinite(v)), [selectedBatches]
  );
  const sourcesKey = useMemo(()=> (sources||[]).join(","), [sources]);

  // // 배치 목록 (단일 소스일 때만)
  // const batchesQ = useQuery({
  //   enabled: !!singleSource,
  //   queryKey: ["wms","batches", singleSource],
  //   queryFn: () => listBatches({ source: singleSource, limit: 50 }),
  // });

  // WMS items
  const itemsQ = useQuery({
    queryKey: ["wms","items", sourcesKey, searchApplied, pageSize, order, selectedBatchIds.join(",")],
    queryFn: ({ signal }) =>
      listWmsItems({
        sources,
        search: searchApplied,
        limit: pageSize === 'ALL' ? undefined : pageSize,
        order,
        batch_ids: selectedBatchIds.length ? selectedBatchIds : undefined,
      }, { signal }),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
    select: (d) => {
      const items = Array.isArray(d) ? d : (Array.isArray(d?.items) ? d.items : []);
      const columns = (!Array.isArray(d) && Array.isArray(d?.columns) && d.columns.length)
        ? d.columns
        : buildOrderedRawColumns(items.slice(0, 300));
      const total = (!Array.isArray(d) && Number.isFinite(d?.total)) ? d.total : items.length;
      return { items, columns, total };
    },
  });

  const items = itemsQ.data?.items ?? [];
  const itemsColumns = itemsQ.data?.columns ?? [];
  const displayItemsColumns = useMemo(
    () => itemsColumns.map(k => ({ key: k, label: normalizeLabel(k) })), [itemsColumns]
  );

  const itemFixedCols = [
    { key: "__sel__", label: "" },
    { key: "row_id", label: "row_id" },
    { key: "source", label: "source" },
    { key: "code", label: "code" },
    { key: "name", label: "name" },
    { key: "unit", label: "unit" },
    { key: "qty",  label: "qty"  },
  ];
  const itemsAllCols = useMemo(
    () => [...itemFixedCols.map(c => c.key), ...displayItemsColumns.map(c => c.key)],
    [displayItemsColumns]
  );
  
  const { widths: itemsColW, onMouseDown: startResizeItems } = useResizableColumns("wms-items");

  // Links
  // const linksQ = useQuery({
  //   enabled: !!(rid && selectedNode),
  //   queryKey: ["wms","links", rid, selectedNode?.std_node_uid],
  //   queryFn: () => listLinks({ rid, uid: selectedNode.std_node_uid })
  // });

  // linkSource: 링크 테이블에 적용할 단일 소스 (복수 선택이면 null)
  const linkSource = sources.length === 1 ? sources[0] : null;

  const linksQ = useQuery({
    enabled: !!(rid && selectedNode),
    queryKey: ["wms","links", rid, selectedNode?.std_node_uid, sourcesKey, selectedBatchIds.join(",")],
    queryFn: () => listLinks({
      rid,
      uid: selectedNode.std_node_uid,
      // source: singleSource ?? undefined,        // 단일 소스일 때만 지정
      // current_only: true,        // 기본 current만
      batch_ids: selectedBatchIds.length ? selectedBatchIds : undefined,
      order: "asc",
    }),
  });

  const linkItems = useMemo(() => linksQ.data ?? [], [linksQ.data]);
  const linkColumns = useMemo(() => {
    const sample = linkItems.length > 300 ? linkItems.slice(0, 300) : linkItems;
    return buildOrderedRawColumns(sample);
  }, [linkItems]);
  const displayLinkColumns = useMemo(
    () => linkColumns.map(k => ({ key: k, label: normalizeLabel(k) })),
    [linkColumns]
  );

  const linkFixedCols = [
    { key: "__link_sel__", label: "" },
    { key: "row_id", label: "row_id" },
    { key: "source", label: "source" },
    { key: "code",   label: "code" },
    { key: "name",   label: "name" },
    { key: "unit",   label: "unit" },
    { key: "qty",    label: "qty"  },
  ];
  const linksAllCols = useMemo(
    () => [...linkFixedCols.map(c => c.key), ...displayLinkColumns.map(c => c.key)],
    [displayLinkColumns]
  );

  const { widths: linksColW, onMouseDown: startResizeLinks } = useResizableColumns("wms-links");

  function collectUids(rootChildren) {
    const set = new Set();
    const walk = (n) => {
      set.add(n.std_node_uid);
      (n.children ?? []).forEach(walk);
    };
    (rootChildren ?? []).forEach(walk);
    return set;
  }

  function uniqueUid(base, taken) {
    let cand = base.slice(0, 64);
    if (!cand) cand = `NODE_${Date.now()}`;
    if (!taken.has(cand)) return cand;
    let i = 2;
    while (taken.has(`${cand}_${i}`)) i += 1;
    return `${cand}_${i}`.slice(0, 64);
  }

  function toUID(name) {
    return name
      .trim()
      .replace(/\s+/g, "_")
      .replace(/[^A-Za-z0-9_]/g, "")
      .toUpperCase()
      .slice(0, 64);
  }

  // CRUD mutations
  const addM = useMutation({
    // ⭐ 루트 생성 시에만 kind 전달, 자식은 부모 상속
    mutationFn: ({ parent, name, uid }) => {
      const finalUid = uid ?? (toUID(name) || `NODE_${Date.now()}`);
      const payload = {
        parent_uid: parent?.std_node_uid ?? null,
        std_node_uid: finalUid,
        name,
        order_index: 0,
      };
      return createStdNode(
        rid,
        payload,
        { kind: parent ? undefined : KIND } // ⭐ 루트면 kind=GWM
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["std","tree", rid, KIND] }), // ⭐ KIND 포함
  });

  const renameM = useMutation({
    mutationFn: ({ node, name }) => updateStdNode(rid, node.std_node_uid, { name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["std","tree",rid,KIND] }), // ⭐
  });

  const delM = useMutation({
    mutationFn: (node) => deleteStdNode(rid, node.std_node_uid),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["std","tree", rid, KIND] }); // ⭐
      if (selectedNode?.std_node_uid === variables.std_node_uid) setSelectedNode(null);
    },
  });

  const assignM = useMutation({
    mutationFn: () => assignLinks({ rid, uid: selectedNode.std_node_uid, row_ids: Array.from(selRowIds) }),
    onSuccess: () => { setSelRowIds(new Set()); qc.invalidateQueries({ queryKey: ["wms","links",rid,selectedNode?.std_node_uid] }); }
  });
  const unassignM = useMutation({
    mutationFn: (row_ids) => unassignLinks({ rid, uid: selectedNode.std_node_uid, row_ids }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wms","links",rid,selectedNode?.std_node_uid] })
  });

  const unassignSelectedM = useMutation({
    mutationFn: () => unassignLinks({
      rid, uid: selectedNode.std_node_uid, row_ids: Array.from(selLinkIds)
    }),
    onSuccess: () => {
      setSelLinkIds(new Set());
      qc.invalidateQueries({ queryKey: ["wms","links",rid,selectedNode?.std_node_uid] });
    }
  });

  // 🔹 릴리즈 액션
  const cloneM = useMutation({
    mutationFn: ({ baseRid, nextVersion, copyLinks }) =>
      cloneRelease(baseRid, { version: nextVersion, copyLinks }),
    onSuccess: (newRel) => {
      qc.invalidateQueries({ queryKey: ["std","releases"] });
      setRid(newRel.id);
      setReleaseStatusLocal(newRel.status || "DRAFT");
    }
  });
  const publishM = useMutation({
    mutationFn: () => setReleaseStatus(rid, "ACTIVE"),
    onSuccess: (rel) => {
      setReleaseStatusLocal(rel.status);
      qc.invalidateQueries({ queryKey:["std","releases"]});
    }
  });
  const archiveM = useMutation({
    mutationFn: () => setReleaseStatus(rid, "ARCHIVED"),
    onSuccess: (rel) => {
      setReleaseStatusLocal(rel.status);
      qc.invalidateQueries({ queryKey:["std","releases"]});
    }
  });

  const toggleRow = (id) => setSelRowIds(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  const toggleLinkRow = (id) => setSelLinkIds(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  const allLinksSelectedOnPage = useMemo(() => {
    const ids = new Set(linkItems.map(r => r.row_id));
    return ids.size>0 && Array.from(ids).every(id => selLinkIds.has(id));
  }, [linkItems, selLinkIds]);
  const toggleLinksPageAll = () => {
    const ids = linkItems.map(r => r.row_id);
    setSelLinkIds(prev => {
      const n = new Set(prev);
      const everyIn = ids.every(id => n.has(id));
      if (everyIn) ids.forEach(id => n.delete(id)); else ids.forEach(id => n.add(id));
      return n;
    });
  };

  const allSelectedOnPage = useMemo(() => {
    const ids = new Set(items.map(r => r.row_id));
    return ids.size>0 && Array.from(ids).every(id => selRowIds.has(id));
  }, [items, selRowIds]);

  const togglePageAll = () => {
    const ids = items.map(r => r.row_id);
    setSelRowIds(prev => {
      const n = new Set(prev);
      const everyIn = ids.every(id => n.has(id));
      if (everyIn) ids.forEach(id => n.delete(id)); else ids.forEach(id => n.add(id));
      return n;
    });
  };

  return (
    <div className="flex h-full w-full flex-col p-4">
      {/* 헤더: Release 선택 */}
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-xl font-semibold">Standard GWM</h2>
        <select
          className="border rounded px-2 py-1"
          value={Number.isFinite(rid) ? String(rid) : ""}
          onChange={(e)=> {
            const v = e.target.value;
            const next = v === "" ? null : Number(v);
            setRid(Number.isFinite(next) ? next : null);
          }}
        >
          <option value="">(릴리즈 선택)</option>
          {relQ.data?.map(r => (
            <option key={r.id} value={String(r.id)}>{r.version}</option>
          ))}
        </select>
        {/* 상태 배지 */}
        <span className={`px-2 py-0.5 rounded text-xs ${
          releaseStatus==="ACTIVE" ? "bg-green-100 text-green-700" :
          releaseStatus==="ARCHIVED" ? "bg-gray-100 text-gray-600" :
          "bg-yellow-100 text-yellow-700"
        }`}>{releaseStatus}</span>

        {/* 릴리즈 셀렉터 오른쪽에 컴팩트 브레드크럼 */}
        <CompactBreadcrumb path={breadcrumbPath} onJump={jumpToUid} />
        {/* ② 버전명으로 검색/선택(간단 프롬프트 버전) */}
        <button
          className="px-2 py-1 border rounded disabled:opacity-50"
          disabled={!rid || !isDraft}
          onClick={async ()=>{
            const v = prompt("Copy links from version (e.g. GWM-2025.08):");
            if (!v) return;
            try {
              const res = await copyLinks(rid, { from_version: v, only_existing_nodes: true });
              alert(`Copied ${res.copied} links from ${res.from_release.version}`);
              qc.invalidateQueries({ queryKey: ["wms","links"] });
            } catch (e) {
              alert(e?.response?.data?.detail || e.message);
            }
          }}
        >Copy Assignments by version…</button>
        {/* <button
          className="px-2 py-1 border rounded disabled:opacity-50"
          disabled={!rid || !isDraft}
          onClick={async ()=>{
            const from = prompt("Copy links from release id?");
            const fromRid = Number(from);
            console.log(fromRid);
            if (!fromRid) return;
            const res = await copyLinksFromRelease(rid, fromRid);
            alert(`Copied ${res.copied} links from #${fromRid} → #${rid}`);
            qc.invalidateQueries({ queryKey: ["wms","links"] }); // 필요 시 더 촘촘히 무효화
          }}
        >
          Copy links…
        </button> */}
        {/* 릴리즈 액션 */}
        <div className="ml-auto flex items-center gap-2">
          <button
            className="px-2 py-1 border rounded disabled:opacity-50"
            disabled={!rid}
            onClick={()=>{
              const v = prompt("New version (e.g. GWM-2025.09)");
              if (!v) return;
              const copy = confirm("Copy WMS links to the new release?");
              cloneM.mutate({ baseRid: rid, nextVersion: v, copyLinks: copy });
            }}
          >New draft</button>
          <button
            className="px-2 py-1 border rounded disabled:opacity-50"
            disabled={!rid || !isDraft}
            onClick={()=> { if (confirm("Publish this draft? It becomes read-only.")) publishM.mutate(); }}
          >Publish</button>
          <button
            className="px-2 py-1 border rounded disabled:opacity-50"
            disabled={!rid || releaseStatus!=="ACTIVE"}
            onClick={()=> { if (confirm("Archive this release?")) archiveM.mutate(); }}
          >Archive</button>
        </div>
      </div>
      <div className="grid grid-cols-12 gap-3 h-[calc(100vh-140px)]">
        {/* 좌측: 트리 + CRUD */}
        <div className="col-span-3 bg-white rounded shadow p-2 overflow-auto">
          <div className="flex items-center justify-between mb-2">
            <span className="font-medium">StdGWM Tree</span>
            <button
              className="text-sm px-2 py-1 border rounded disabled:opacity-50"
              disabled={!rid || !isDraft}
              onClick={()=>{
                if (!rid) { alert("먼저 Release를 선택하세요."); return; }
                const name = prompt("Root node name?", "GWM");
                if (!name) return;
                const uid = toUID(name) || `GWM_${Date.now()}`;
                // ⭐ 루트 생성은 kind=GWM 전달
                addM.mutate({ parent: null, name, uid });
              }}
            >＋ Root</button>
          </div>
          {treeQ.data?.children?.map(n =>
            <TreeNode key={n.std_node_uid}
              node={n}
              selectedUid={selectedNode?.std_node_uid}
              onSelect={setSelectedNode}
              onAddChild={(parent)=>{
                if (!Number.isFinite(rid)) return alert("먼저 Release를 선택하세요.");
                if (!isDraft) { alert("DRAFT 상태에서만 편집할 수 있습니다."); return; };
                const name = prompt("Child node name?");
                if (!name) return;
                const base = toUID(name) || `NODE_${Date.now()}`;
                const taken = collectUids(treeQ.data?.children ?? []);
                const uid = uniqueUid(base, taken);
                addM.mutate({ parent, name, uid }); // 자식은 부모 상속
              }}
              onRename={(node)=>{
                if (!rid) { alert("먼저 Release를 선택하세요."); return; };
                if (!isDraft) { alert("DRAFT 상태에서만 편집할 수 있습니다."); return; };
                const name = prompt("New name", node.name);
                if (name && name!==node.name) renameM.mutate({ node, name });
              }}
              onDelete={(node)=>{
                if (!rid) { alert("먼저 Release를 선택하세요."); return; };
                if (!isDraft) { alert("DRAFT 상태에서만 편집할 수 있습니다."); return; }
                if (confirm(`Delete "${node.name}" and all children?`)) delM.mutate(node);
              }}
              canEdit={isDraft}
            />
          )}
        </div>

        {/* 오른쪽: 중간 + 우측 수직 스택 */}
        <div className="col-span-9 flex flex-col min-h-0">
          {/* 위: Assignments */}
          <div className="bg-white rounded shadow flex flex-col min-h-0 shrink-0 basis-2/5">
            <div className="shrink-0 px-3 py-2 border-b flex items-center justify-between">
              <div>
                <div className="font-medium">Assignments</div>
                <div className="text-xs text-gray-500">
                  Node: {selectedNode ? selectedNode.name : "(select on left)"} / Selected rows: {selRowIds.size}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="px-3 py-1 border rounded disabled:opacity-50"
                  disabled={!selectedNode || selRowIds.size===0 || !isLevel2 || !isDraft}
                  onClick={()=>assignM.mutate()}
                  title="레벨2 노드에서만 할당 가능"
                >
                  Assign selected ↓
                </button>
                <button
                  className="px-3 py-1 border rounded disabled:opacity-50 text-red-600"
                  disabled={!selectedNode || selLinkIds.size===0 || !isDraft}
                  onClick={()=>unassignSelectedM.mutate()}
                  title="상단 Assignments 테이블에서 선택한 행들 해제"
                >Unassign selected</button>
              </div>
            </div>

            <div className="grow min-h-0 overflow-auto">
              <table className="min-w-max text-sm table-auto">
                <colgroup>
                  {linksAllCols.map((k) => (
                    <col key={k} style={{ width: linksColW[k] ? `${linksColW[k]}px` : undefined }} />
                  ))}
                </colgroup>
                <thead className="sticky top-0 z-10 bg-gray-50 shadow-sm">
                  <tr>
                    <ResizableTH colKey="__link_sel__" widths={linksColW} onMouseDown={startResizeLinks} min={36}>
                      <input type="checkbox" checked={allLinksSelectedOnPage} onChange={toggleLinksPageAll} />
                    </ResizableTH>
                    <ResizableTH colKey="row_id" widths={linksColW} onMouseDown={startResizeLinks}>
                      row_id
                    </ResizableTH>
                    <ResizableTH colKey="source" widths={linksColW} onMouseDown={startResizeLinks}>source</ResizableTH>
                    <ResizableTH colKey="code"   widths={linksColW} onMouseDown={startResizeLinks}>code</ResizableTH>
                    <ResizableTH colKey="name"   widths={linksColW} onMouseDown={startResizeLinks}>name</ResizableTH>
                    <ResizableTH colKey="unit"   widths={linksColW} onMouseDown={startResizeLinks}>unit</ResizableTH>
                    <ResizableTH colKey="qty"    widths={linksColW} onMouseDown={startResizeLinks}>qty</ResizableTH>
                    {displayLinkColumns.map(c => (
                      <ResizableTH key={c.key} colKey={c.key} widths={linksColW} onMouseDown={startResizeLinks}>
                        {c.label}
                      </ResizableTH>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {linkItems.map(l => (
                    <tr key={l.row_id} className="odd:bg-white even:bg-gray-50">
                      <td className="p-2">
                        <input type="checkbox" checked={selLinkIds.has(l.row_id)} onChange={()=>toggleLinkRow(l.row_id)} />
                      </td>
                      <td className="p-2">
                        <div className="flex items-center gap-2 whitespace-nowrap">
                          <span>{l.row_id}</span>
                          <button
                            className="text-xs px-1 py-0.5 border rounded text-red-600"
                            title="Unassign this row"
                            onClick={()=>unassignM.mutate([l.row_id])}
                          >✕</button>
                        </div>
                      </td>
                      <td className="p-2">{l.source}</td>
                      <td className="p-2">{l.code}</td>
                      <td className="p-2">{l.name}</td>
                      <td className="p-2">{l.unit ?? ""}</td>
                      <td className="p-2">{l.qty ?? ""}</td>
                      {displayLinkColumns.map(c => (
                        <td key={c.key} className="p-2">{String((l._raw?.[c.key] ?? l[c.key] ?? ""))}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 아래: WMS Items */}
          <div className="bg-white rounded shadow flex flex-col grow min-h-0">
            <div className="shrink-0 px-3 py-2 border-b flex items-center gap-2">
              <span className="font-medium">WMS Items</span>
              <label className="text-sm ml-2">Filter:</label>
              {["AR","FP","SS"].map(s => (
                <label key={s} className="text-sm inline-flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={sources.includes(s)}
                    onChange={(e)=>{
                      setSources(prev => e.target.checked ? Array.from(new Set([...prev,s])) : prev.filter(x=>x!==s));
                    }}
                  />
                  {s}
                </label>
              ))}
              {/* 기존 Filter 체크박스들 옆에, 소스별 배치 선택 드롭다운들 */}
              <div className="flex items-center gap-2 flex-wrap">
                {["AR","FP","SS"].map(src => (
                  sources.includes(src) ? (
                    <div key={src} className="flex items-center gap-1">
                      <label className="text-sm">{src} Batch:</label>
                      <select
                        className="border rounded px-2 py-1 text-sm"
                        value={selectedBatches[src] ?? ""}
                        onChange={(e)=>{
                          const v = e.target.value ? Number(e.target.value) : null;
                          setSelectedBatches(prev => ({ ...prev, [src]: v }));
                        }}
                      >
                        <option value="">(All / Current)</option>
                        {(batchesBySource[src] || []).map(b => (
                          <option key={b.id} value={b.id}>
                            #{b.id} [{b.status}] total:{b.total_rows}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null
                ))}
              </div>
              <div className="ml-auto flex items-center gap-2">
                <input
                  className="border rounded px-2 py-1 text-sm"
                  placeholder="Search (press Enter)…"
                  value={searchDraft}
                  onChange={(e)=>setSearchDraft(e.target.value)}
                  onKeyDown={(e)=>{
                    if (e.key === 'Enter' && !isComposing.current) applySearch();
                    if (e.key === 'Escape') { setSearchDraft(""); setSearchApplied(""); }
                  }}
                  onCompositionStart={()=>{ isComposing.current = true; }}
                  onCompositionEnd={(e)=>{ isComposing.current = false; setSearchDraft(e.currentTarget.value); }}
                />
                <button
                  className="px-3 py-1 border rounded text-sm"
                  onClick={applySearch}
                  disabled={searchDraft.trim() === searchApplied.trim()}
                  title="Apply search"
                >Search</button>
                <button
                  className="px-2 py-1 border rounded text-sm"
                  onClick={()=>{ setSearchDraft(""); setSearchApplied(""); }}
                  title="Clear"
                >Clear</button>
                {searchDraft !== searchApplied && (
                  <span className="text-xs text-gray-500">pending… (press Enter)</span>
                )}
              </div>
              <label className="text-sm">Rows:</label>
              <select
                className="border rounded px-2 py-1"
                value={String(pageSize)}
                onChange={e=>setPageSize(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))}
              >
                <option value="ALL">All</option>
                <option value="200">200</option>
                <option value="500">500</option>
                <option value="1000">1000</option>
              </select>
            </div>

            <div className="grow min-h-0 overflow-auto">
              <table className="min-w-max text-sm table-auto">
                <colgroup>
                  {itemsAllCols.map((k) => (
                    <col key={k} style={{ width: itemsColW[k] ? `${itemsColW[k]}px` : undefined }} />
                  ))}
                </colgroup>
                <thead className="sticky top-0 z-10 bg-gray-50 shadow-sm">
                  <tr>
                    <ResizableTH colKey="__sel__" widths={itemsColW} onMouseDown={startResizeItems} min={36}>
                      <input type="checkbox" checked={allSelectedOnPage} onChange={togglePageAll} />
                    </ResizableTH>
                    <ResizableTH colKey="row_id" widths={itemsColW} onMouseDown={startResizeItems}>row_id</ResizableTH>
                    <ResizableTH colKey="source" widths={itemsColW} onMouseDown={startResizeItems}>source</ResizableTH>
                    <ResizableTH colKey="code"   widths={itemsColW} onMouseDown={startResizeItems}>code</ResizableTH>
                    <ResizableTH colKey="name"   widths={itemsColW} onMouseDown={startResizeItems}>name</ResizableTH>
                    <ResizableTH colKey="unit"   widths={itemsColW} onMouseDown={startResizeItems}>unit</ResizableTH>
                    <ResizableTH colKey="qty"    widths={itemsColW} onMouseDown={startResizeItems}>qty</ResizableTH>
                    {displayItemsColumns.map(c => (
                      <ResizableTH key={c.key} colKey={c.key} widths={itemsColW} onMouseDown={startResizeItems}>
                        {c.label}
                      </ResizableTH>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map(r => (
                    <tr key={r.row_id} className="odd:bg-white even:bg-gray-50">
                      <td className="p-2">
                        <input type="checkbox" checked={selRowIds.has(r.row_id)} onChange={()=>toggleRow(r.row_id)} />
                      </td>
                      <td className="p-2">{r.row_id}</td>
                      <td className="p-2">{r.source}</td>
                      <td className="p-2">{r.code}</td>
                      <td className="p-2">{r.name}</td>
                      <td className="p-2">{r.unit ?? ""}</td>
                      <td className="p-2">{r.qty ?? ""}</td>
                      {displayItemsColumns.map(c => (
                        <td key={c.key} className="p-2">{String((r._raw?.[c.key] ?? r[c.key] ?? ""))}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
