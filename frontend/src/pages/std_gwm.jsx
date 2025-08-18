import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listStdReleases, getStdTree, createStdNode, updateStdNode, deleteStdNode
} from "../shared/api/std";
import {
  listWmsItems, listLinks, assignLinks, unassignLinks
} from "../shared/api/wms";
import { buildOrderedRawColumns, normalizeLabel } from "../shared/api/columnOrder"; // ← 경로 확인!
import { useResizableColumns, ResizableTH, ResizableColgroup } from "../shared/ui/resizableColumns";


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
  const [selLinkIds, setSelLinkIds] = useState(new Set());
  const [pageSize, setPageSize] = useState("ALL");
  const [order, setOrder] = useState("asc");
  
  // 릴리즈 바뀔 때 상태 리셋(안전)
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
    }
  });

  // Tree
  const treeQ = useQuery({
    enabled: !!rid,
    queryKey: ["std","tree",rid],
    queryFn: () => getStdTree(rid)
  });

  // WMS items (우측 하단)
  const itemsQ = useQuery({
    queryKey: ["wms","items", sources, search, pageSize, order],
    queryFn: () =>
      listWmsItems({
        sources,
        search,
        limit: pageSize === 'ALL' ? undefined : pageSize,
        order,
      }),
    refetchOnWindowFocus: false
  });

  // ✅ 항상 배열로 정규화 (롤백 상태 가정)
  const items = useMemo(() => itemsQ.data ?? [], [itemsQ.data]);

  // ✅ 내가 정한 순서로 _raw 컬럼 계산 + 라벨 정리
  const itemsColumns = useMemo(() => buildOrderedRawColumns(items), [items]);
  const displayItemsColumns = useMemo(
    () => itemsColumns.map(k => ({ key: k, label: normalizeLabel(k) })),
    [itemsColumns]
  );

  const itemFixedCols = [
    { key: "__sel__", label: "" },   // 체크박스
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

  // Links (우상단)
  const linksQ = useQuery({
    enabled: !!(rid && selectedNode),
    queryKey: ["wms","links", rid, selectedNode?.std_node_uid],
    queryFn: () => listLinks({ rid, uid: selectedNode.std_node_uid })
  });

  const linkItems = useMemo(() => linksQ.data ?? [], [linksQ.data]);
  const linkColumns = useMemo(() => buildOrderedRawColumns(linkItems), [linkItems]);
  const displayLinkColumns = useMemo(
    () => linkColumns.map(k => ({ key: k, label: normalizeLabel(k) })),
    [linkColumns]
  );

  const linkFixedCols = [
    { key: "__link_sel__", label: "" }, // 선택 체크박스
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
      const finalUid = uid ?? (toUID(name) || `NODE_${Date.now()}`);
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
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["std","tree", rid] });
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

  // ✅ Assignments 일괄 Unassign
  const unassignSelectedM = useMutation({
    mutationFn: () => unassignLinks({
      rid, uid: selectedNode.std_node_uid, row_ids: Array.from(selLinkIds)
    }),
    onSuccess: () => {
      setSelLinkIds(new Set());
      qc.invalidateQueries({ queryKey: ["wms","links",rid,selectedNode?.std_node_uid] });
    }
  });

  // UI helpers
  const toggleRow = (id) => setSelRowIds(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  // ✅ Assignments 선택 토글
  const toggleLinkRow = (id) => setSelLinkIds(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });


  // ✅ Assignments 페이지 전체 선택/해제
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
      </div>

      <div className="grid grid-cols-12 gap-3 h-[calc(100vh-140px)]">
        {/* 좌측: 트리 + CRUD */}
        <div className="col-span-3 bg-white rounded shadow p-2 overflow-auto">
          <div className="flex items-center justify-between mb-2">
            <span className="font-medium">StdGWM Tree</span>
            <button
              className="text-sm px-2 py-1 border rounded disabled:opacity-50"
              disabled={!rid}
              onClick={()=>{
                if (!rid) { alert("먼저 Release를 선택하세요."); return; }
                const name = prompt("Root node name?", "GWM");
                if (!name) return;
                const uid = toUID(name) || `GWM_${Date.now()}`;
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
                const name = prompt("Child node name?");
                if (!name) return;
                const base = toUID(name) || `NODE_${Date.now()}`;
                const taken = collectUids(treeQ.data?.children ?? []);
                const uid = uniqueUid(base, taken);
                addM.mutate({ parent, name, uid });
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
                  disabled={!selectedNode || selRowIds.size===0}
                  onClick={()=>assignM.mutate()}
                  title="아래 WMS Items 테이블에서 선택한 행을 현재 노드에 할당"
                >Assign selected ↓</button>
                <button
                  className="px-3 py-1 border rounded disabled:opacity-50 text-red-600"
                  disabled={!selectedNode || selLinkIds.size===0}
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
              <input
                className="border rounded px-2 py-1 text-sm ml-auto"
                placeholder="Search any column..."
                value={search}
                onChange={(e)=>setSearch(e.target.value)}
              />
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
