import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listStdReleases, getStdTree, createStdNode, updateStdNode, deleteStdNode
} from "../shared/api/std";
import {
  listWmsItems, listLinks, assignLinks, unassignLinks
} from "../shared/api/wms";

function TreeNode({ node, onSelect, selectedUid, onAddChild, onRename, onDelete }) {
  const hasChildren = (node.children ?? []).length > 0;
  const isSel = selectedUid === node.std_node_uid;
  return (
    <div className="pl-2">
      <div className={`flex items-center gap-2 py-0.5 ${isSel ? "bg-blue-50" : ""}`}>
        <button className="text-left flex-1" onClick={() => onSelect(node)} title={node.path}>
          {node.name}
        </button>
        <button className="text-xs px-2 py-0.5 border rounded" onClick={() => onAddChild(node)}>＋</button>
        <button className="text-xs px-2 py-0.5 border rounded" onClick={() => onRename(node)}>✎</button>
        <button className="text-xs px-2 py-0.5 border rounded text-red-600" onClick={() => onDelete(node)}>🗑</button>
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
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function StdGwmPage() {
  const qc = useQueryClient();
  const [rid, setRid] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [sources, setSources] = useState(["AR","FP","SS"]);
  const [search, setSearch] = useState("");
  const [selRowIds, setSelRowIds] = useState(new Set());
  const [pageSize, setPageSize] = useState(500); // 필요시 All 처리 가능 number | 'ALL'

  // Releases
  const relQ = useQuery({
    queryKey: ["std","releases"],
    queryFn: listStdReleases,
    onSuccess: (data) => {
      if (!Number.isFinite(rid) && data?.length) {
        const first = Number(data[0].id);
        setRid(Number.isFinite(first) ? first : null);
      }
    }
  });

  // Tree
  const treeQ = useQuery({
    enabled: !!rid,
    queryKey: ["std","tree",rid],
    queryFn: () => getStdTree(rid)
  });

  // WMS items (우측)
  const itemsQ = useQuery({
    queryKey: ["wms","items", sources, search, pageSize],
    queryFn: () =>
      listWmsItems({
        sources,
        search,
        // 'ALL'이면 limit 파라미터 자체를 생략(서버가 전체 반환)
        limit: pageSize === 'ALL' ? undefined : pageSize
      }),
    refetchOnWindowFocus: false
  });

  const dynCols = useMemo(() => {
    const freq = new Map();
    for (const r of itemsQ.data ?? []) {
      const raw = r?._raw || {};
      Object.keys(raw).forEach(k => freq.set(k, (freq.get(k) || 0) + 1));
    }
    return Array.from(freq.entries())
      .sort((a,b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
      .map(([k]) => k);
  }, [itemsQ.data]);

  // Links (중앙 - 선택 노드)
  const linksQ = useQuery({
    enabled: !!(rid && selectedNode),
    queryKey: ["wms","links", rid, selectedNode?.std_node_uid],
    queryFn: () => listLinks({ rid, uid: selectedNode.std_node_uid })
  });

  // 1) 트리에서 모든 UID 수집
  function collectUids(rootChildren) {
    const set = new Set();
    const walk = (n) => {
      set.add(n.std_node_uid);
      (n.children ?? []).forEach(walk);
    };
    (rootChildren ?? []).forEach(walk);
    return set;
  }

  // 2) 중복 회피 함수
  function uniqueUid(base, taken) {
    let cand = base.slice(0, 64);
    if (!cand) cand = `NODE_${Date.now()}`;
    if (!taken.has(cand)) return cand;
    let i = 2;
    while (taken.has(`${cand}_${i}`)) i += 1;
    return `${cand}_${i}`.slice(0, 64);
  }

  // 간단 UID 변환기
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
    mutationFn: ({ parent, name, uid }) => {
      const finalUid = uid ?? (toUID(name) || `NODE_${Date.now()}`); // ✅ fallback
      return createStdNode(rid, {
        parent_uid: parent?.std_node_uid ?? null,
        std_node_uid: finalUid,
        name,
        order_index: 0,
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["std","tree", rid] }),
  });

  const renameM = useMutation({
    mutationFn: ({ node, name }) => updateStdNode(rid, node.std_node_uid, { name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["std","tree",rid] }),
  });
  const delM = useMutation({
    mutationFn: (node) => deleteStdNode(rid, node.std_node_uid),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["std","tree",rid] }); if (selectedNode?.std_node_uid===node.std_node_uid) setSelectedNode(null); },
  });

  const assignM = useMutation({
    mutationFn: () => assignLinks({ rid, uid: selectedNode.std_node_uid, row_ids: Array.from(selRowIds) }),
    onSuccess: () => { setSelRowIds(new Set()); qc.invalidateQueries({ queryKey: ["wms","links",rid,selectedNode?.std_node_uid] }); }
  });
  const unassignM = useMutation({
    mutationFn: (row_ids) => unassignLinks({ rid, uid: selectedNode.std_node_uid, row_ids }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wms","links",rid,selectedNode?.std_node_uid] })
  });

  // UI helpers
  const toggleRow = (id) => setSelRowIds(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const allSelectedOnPage = useMemo(() => {
    const ids = new Set(itemsQ.data?.map(r => r.row_id) ?? []);
    return ids.size>0 && Array.from(ids).every(id => selRowIds.has(id));
  }, [itemsQ.data, selRowIds]);

  const togglePageAll = () => {
    const ids = (itemsQ.data ?? []).map(r => r.row_id);
    setSelRowIds(prev => {
      const n = new Set(prev);
      const everyIn = ids.every(id => n.has(id));
      if (everyIn) ids.forEach(id => n.delete(id)); else ids.forEach(id => n.add(id));
      return n;
    });
  };

  return (
    <div className="p-4 h-full">
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
      </div>

      <div className="grid grid-cols-12 gap-3 h-[calc(100vh-140px)]">
        {/* 좌측: 트리 + CRUD */}
        <div className="col-span-3 bg-white rounded shadow p-2 overflow-auto">
          <div className="flex items-center justify-between mb-2">
            <span className="font-medium">StdGWM Tree</span>
            <button
            className="text-sm px-2 py-1 border rounded disabled:opacity-50"
            disabled={!rid}                               // ✅ 릴리스 없으면 비활성화
            onClick={()=>{
                if (!rid) { alert("먼저 Release를 선택하세요."); return; }  // ✅ 가드
                const name = prompt("Root node name?", "GWM");
                if (!name) return;
                const uid = toUID(name) || `GWM_${Date.now()}`;   // 최후 fallback
                addM.mutate({ parent: null, name, uid });         // ✅ 두 번째 UID 프롬프트 제거
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
                const name = prompt("Child node name?");
                if (!name) return;
                const base = toUID(name) || `NODE_${Date.now()}`;
                const taken = collectUids(treeQ.data?.children ?? []);
                // 부모와 동일한 UID가 되면 여기서 _2 붙여 회피
                const uid = uniqueUid(base, taken);
                addM.mutate({ parent, name, uid }); // ✅ 이제 항상 유일
              }}
              onRename={(node)=>{
              if (!rid) { alert("먼저 Release를 선택하세요."); return; }
              const name = prompt("New name", node.name);
              if (name && name!==node.name) renameM.mutate({ node, name });
              }}
              onDelete={(node)=>{
              if (!rid) { alert("먼저 Release를 선택하세요."); return; }
              if (confirm(`Delete "${node.name}" and all children?`)) delM.mutate(node);
              }}
            />
          )}
        </div>

        {/* 중앙: 선택 노드에 대한 링크 관리 */}
        <div className="col-span-4 bg-white rounded shadow p-3 overflow-auto flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="font-medium">Assignments</div>
              <div className="text-xs text-gray-500">
                Node: {selectedNode ? selectedNode.name : "(select on left)"} / Selected rows: {selRowIds.size}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button className="px-3 py-1 border rounded disabled:opacity-50"
                disabled={!selectedNode || selRowIds.size===0}
                onClick={()=>assignM.mutate()}
                title="우측 테이블에서 선택한 행을 현재 노드에 할당"
              >Assign selected →</button>
            </div>
          </div>

          <div className="text-sm font-medium mb-1">Currently linked</div>
          <div className="overflow-auto border rounded">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="p-2 text-left">row_id</th>
                  <th className="p-2 text-left">source</th>
                  <th className="p-2 text-left">code</th>
                  <th className="p-2 text-left">name</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {linksQ.data?.map(l=>(
                  <tr key={l.row_id} className="odd:bg-white even:bg-gray-50">
                    <td className="p-2">{l.row_id}</td>
                    <td className="p-2">{l.source}</td>
                    <td className="p-2">{l.code}</td>
                    <td className="p-2">{l.name}</td>
                    <td className="p-2">
                      <button className="text-red-600 text-xs underline"
                        onClick={()=>unassignM.mutate([l.row_id])}
                      >Unassign</button>
                    </td>
                  </tr>
                )) ?? null}
              </tbody>
            </table>
          </div>
        </div>

        {/* 우측: WMS 아이템 테이블(AR/FP/SS 통합) */}
        <div className="col-span-5 bg-white rounded shadow p-3 overflow-auto">
          <div className="flex items-center gap-2 mb-2">
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
            <input className="border rounded px-2 py-1 text-sm ml-auto"
              placeholder="Search code/name..."
              value={search}
              onChange={(e)=>setSearch(e.target.value)}
            />
            <label className="text-sm">Rows:</label>
            <select
              className="border rounded px-2 py-1"
              value={String(pageSize)}
              onChange={(e)=>{
                const v = e.target.value;
                setPageSize(v === 'ALL' ? 'ALL' : Number(v));
              }}
            >
              <option value="ALL">All</option>
              <option value="200">200</option>
              <option value="500">500</option>
              <option value="1000">1000</option>
            </select>
          </div>

          {/* <div className="overflow-auto border rounded">
            <table className="min-w-full text-sm"> */}
          <div className="overflow-auto border rounded">
            {/* 많은 컬럼을 위해 min-w-max 로 가로 스크롤 허용 */}
            <table className="min-w-max text-sm table-auto">
              <thead className="bg-gray-50">
                <tr>
                  <th className="p-2"><input type="checkbox" checked={allSelectedOnPage} onChange={togglePageAll} /></th>
                  <th className="p-2 text-left">row_id</th>
                  <th className="p-2 text-left">src</th>
                  <th className="p-2 text-left">code</th>
                  <th className="p-2 text-left">name</th>
                  <th className="p-2 text-left">unit</th>
                  <th className="p-2 text-left">qty</th>
                  {/* ✅ 동적 원본 컬럼들 */}
                  {dynCols.map(c => (
                    <th key={c} className="p-2 text-left">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {itemsQ.data?.map(r => (
                  <tr key={r.row_id} className="odd:bg-white even:bg-gray-50">
                    <td className="p-2"><input type="checkbox" checked={selRowIds.has(r.row_id)} onChange={()=>toggleRow(r.row_id)} /></td>
                    <td className="p-2">{r.row_id}</td>
                    <td className="p-2">{r.source}</td>
                    <td className="p-2">{r.code}</td>
                    <td className="p-2">{r.name}</td>
                    <td className="p-2">{r.unit ?? ""}</td>
                    <td className="p-2">{r.qty ?? ""}</td>
                    {/* ✅ 각 행의 해당 값 렌더 */}
                    {dynCols.map(c => (
                      <td key={c} className="p-2">
                        {String(r._raw?.[c] ?? "")}
                      </td>
                    ))}
                  </tr>
                )) ?? null}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
