import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
// import { listBatches, previewBatch, ingestWms, validateBatch } from "../shared/api/wms";
import { uploadExcel, listBatches, previewBatch, ingestWms, validateBatch, deleteBatch } from "../shared/api/wms";
import { useRef } from "react";
import { FixedSizeList as List } from "react-window";

function UploadBox({ onUploaded }) {
  const inputRef = useRef(null);
  const [src, setSrc] = useState("AR");
  const [dryRun, setDryRun] = useState(true);
  const [result, setResult] = useState(null);

  const onPick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const data = await uploadExcel({ file, source: src, dry_run: dryRun });
    setResult(data);
    if (!dryRun && data.batch_id) onUploaded?.(data.batch_id);
  };

  return (
    <div className="flex items-center gap-2">
      <select className="border rounded px-2 py-1" value={src} onChange={e=>setSrc(e.target.value)}>
        <option>AR</option><option>FP</option><option>SS</option>
      </select>
      <label className="inline-flex items-center gap-1 text-sm">
        <input type="checkbox" checked={dryRun} onChange={e=>setDryRun(e.target.checked)} />
        Dry-run
      </label>
      <button className="px-3 py-2 rounded border" onClick={()=>inputRef.current?.click()}>
        Upload Excel
      </button>
      <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={onPick} />
      {result ? (
        <span className="text-xs text-gray-500">
          {result.dry_run ? `detected: ${result.detected_items}` : `batch #${result.batch_id}, count: ${result.count}`}
        </span>
      ) : null}
    </div>
  );
}

function VirtualTable({ rows }) {
  // ✅ rows가 바뀔 때만 전개/컬럼 계산 (불필요한 재계산 차단)
  const { flatRows, columns } = useMemo(() => {
    const flat = rows.map((r) => {
      const p = r.payload_json || {};
      const flattened = { ...p, ...(p._raw || {}) };
      delete flattened._raw;
      return { row_index: r.row_index, status: r.status, ...flattened };
    });

    // 컬럼 순서: 고정 키 → 동적 키(사전순)
    const fixed = ["row_index", "status"];
    const dyn = Array.from(
      new Set(
        flat.flatMap((r) => Object.keys(r))
      )
    ).filter((k) => !fixed.includes(k));
    dyn.sort();

    return { flatRows: flat, columns: [...fixed, ...dyn] };
  }, [rows]);

  const rowHeight = 36;
  const header = (
    <div className="grid grid-flow-col auto-cols-fr bg-gray-50 px-2 py-1 font-medium border-b">
      {columns.map((c) => (
        <div key={c} className="truncate">{c}</div>
      ))}
    </div>
  );

  // 가시 높이: 행 수에 따라 최소/최대 clamp
  const height = Math.min(560, Math.max(240, flatRows.length * rowHeight));

  const Row = ({ index, style }) => {
    const r = flatRows[index];
    return (
      <div style={style} className={`grid grid-flow-col auto-cols-fr px-2 py-1 border-b ${index % 2 ? "bg-gray-50" : "bg-white"}`}>
        {columns.map((c) => (
          <div key={c} className="truncate">{r[c] == null ? "" : String(r[c])}</div>
        ))}
      </div>
    );
  };

  return (
    <div className="overflow-hidden border rounded">
      {header}
      <List
        height={height}
        itemCount={flatRows.length}
        itemSize={rowHeight}
        width={"100%"}
      >
        {Row}
      </List>
    </div>
  );
}


// function SimpleTable({ rows }) {
//   // rows[*].payload_json 에는 top-level(code,name,qty,unit,group_code) + _raw(원본전체)
//   const flatRows = rows.map(r => {
//     const p = r.payload_json || {};
//     const flattened = { ...p, ...(p._raw || {}) }; // ✅ 원본 열 펼침
//     // 원본이 표시되면 _raw 키 자체는 제거
//     delete flattened._raw;
//     return { row_index: r.row_index, status: r.status, ...flattened };
//   });

//   const columns = Array.from(
//     new Set(
//       flatRows.reduce((acc, r) => {
//         Object.keys(r).forEach(k => acc.push(k));
//         return acc;
//       }, [])
//     )
//   );

//   return (
//     <div className="overflow-auto border rounded">
//       <table className="min-w-full text-sm">
//         <thead className="bg-gray-50">
//           <tr>
//             {columns.map(c => <th key={c} className="text-left p-2 border-b">{c}</th>)}
//           </tr>
//         </thead>
//         <tbody>
//           {flatRows.map((r, idx) => (
//             <tr key={idx} className="odd:bg-white even:bg-gray-50">
//               {columns.map(c => (
//                 <td key={c} className="p-2 border-b">
//                   {r[c] == null ? "" : String(r[c])}
//                 </td>
//               ))}
//             </tr>
//           ))}
//         </tbody>
//       </table>
//     </div>
//   );
// }


export default function WmsPage() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState(null);

  const batchesQ = useQuery({ queryKey: ["wms","batches"], queryFn: listBatches, refetchOnWindowFocus: false });

  const [pageSize, setPageSize] = useState(50); // 50 | 100 | 500 | 'ALL'
  const isAll = pageSize === 'ALL';
  const ALL_CAP = 5000; // 안전한 상한 (필요 시 조정)

  const previewQ = useQuery({
    enabled: !!selected,
    queryKey: ["wms", "preview", selected, pageSize],
    queryFn: () =>
      previewBatch(
        selected,
        {
          // ✅ All이면 limit 미전달(서버 기본값) 또는 상한 적용 선택
          limit: isAll ? undefined : pageSize,
          offset: 0,
        }
      ),
    keepPreviousData: true,
    placeholderData: [],
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
    select: (rows) => {
      // ⚠️ 혹시 서버가 ALL에서 너무 많이 줄 경우, 클라이언트 안전상한으로 절단
      if (isAll && Array.isArray(rows) && rows.length > ALL_CAP) {
        return rows.slice(0, ALL_CAP);
      }
      return rows;
    },
  });

  const ingestM = useMutation({
    mutationFn: ingestWms,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wms","batches"] }),
  });

  const validateM = useMutation({
    mutationFn: ({ batchId, fields }) => validateBatch(batchId, fields),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wms","batches"] }),
  });

  const deleteM = useMutation({
    mutationFn: deleteBatch,
    onSuccess: () => {
      setSelected(null);
      qc.invalidateQueries({ queryKey: ["wms","batches"] });
    },
  });

  return (
    <div className="space-y-4">
      {/* 상단: Ingest / Validate */}
      <UploadBox onUploaded={()=>qc.invalidateQueries({ queryKey: ["wms","batches"] })} />
      <div className="p-4 bg-white rounded shadow flex items-center gap-2">
        <button
          className="px-3 py-2 rounded border"
          onClick={() =>
            ingestM.mutate({
              source: "ui",
              uploader: "dev",
              items: [
                { code: "A01", name: "Excavation", qty: 10, unit: "M3" },
                { code: "",    name: "Backfill",   qty: 5,  unit: "M3" },
              ],
            })
          }
        >
          + Ingest demo 2 rows
        </button>

        <div className="ml-auto flex items-center gap-2">
          <select
            className="border rounded px-2 py-1"
            value={selected ?? ""}
            onChange={(e) => setSelected(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Select batch...</option>
            {batchesQ.data?.map(b => (
              <option key={b.id} value={b.id}>
                #{b.id} {b.source ?? ""} [{b.status}] total:{b.total_rows} err:{b.error_rows}
              </option>
            ))}
          </select>
          {/* ✅ 행수 선택 */}
          <label className="text-sm text-gray-600">Rows:</label>
          <select
            className="border rounded px-2 py-1"
            value={String(pageSize)}
            onChange={(e) => {
              const v = e.target.value;
              setPageSize(v === 'ALL' ? 'ALL' : Number(v));
            }}
          >
            <option value="50">50</option>
            <option value="100">100</option>
            <option value="500">500</option>
            <option value="ALL">All</option>
          </select>
          <button
            className="px-3 py-2 rounded border"
            disabled={!selected}
            onClick={() => selected && validateM.mutate({ batchId: selected, fields: ["code", "name", "qty"] })}
            title="필수 필드(code,name,qty) 간단 검증"
          >
            Validate
          </button>
          <button
            className="px-3 py-2 rounded border text-red-600 border-red-300 disabled:opacity-50"
            disabled={!selected || deleteM.isPending}
            onClick={() => {
              if (!selected) return;
              if (window.confirm(`Delete batch #${selected}? This cannot be undone.`)) {
                deleteM.mutate(selected);
              }
            }}
            title="선택한 배치와 하위 행 전체 삭제"
          >
            Delete batch
          </button>
        </div>
      </div>

      {/* 배치 리스트 */}
      <div className="p-4 bg-white rounded shadow">
        <h3 className="font-semibold mb-2">Batches</h3>
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-2 border-b">ID</th>
                <th className="text-left p-2 border-b">Source</th>
                <th className="text-left p-2 border-b">Status</th>
                <th className="text-left p-2 border-b">Received</th>
                <th className="text-left p-2 border-b">Totals</th>
              </tr>
            </thead>
            <tbody>
              {batchesQ.data?.map(b => (
                <tr key={b.id} className="odd:bg-white even:bg-gray-50">
                  <td className="p-2 border-b">{b.id}</td>
                  <td className="p-2 border-b">{b.source ?? "-"}</td>
                  <td className="p-2 border-b">{b.status}</td>
                  <td className="p-2 border-b">{b.received_at ?? "-"}</td>
                  <td className="p-2 border-b">total {b.total_rows}, ok {b.ok_rows}, err {b.error_rows}</td>
                </tr>
              )) ?? null}
            </tbody>
          </table>
        </div>
      </div>

      {/* 프리뷰 */}
      <div className="p-4 bg-white rounded shadow">
        <div className="flex items-center gap-3 mb-2">
          <h3 className="font-semibold">Preview {selected ? `#${selected}` : ""}</h3>
          {previewQ.isFetching ? <span className="text-xs text-gray-500">Loading…</span> : null}
          {isAll && previewQ.data && previewQ.data.length >= ALL_CAP ? (
            <span className="text-xs text-amber-600">
              Showing first {ALL_CAP.toLocaleString()} rows (ALL capped for performance)
            </span>
          ) : null}
          {Array.isArray(previewQ.data) ? (
            <span className="ml-auto text-xs text-gray-500">
              {previewQ.data.length.toLocaleString()} rows
            </span>
          ) : null}
        </div>

        {previewQ.isLoading ? (
          <div>Loading...</div>
        ) : Array.isArray(previewQ.data) && previewQ.data.length ? (
          <VirtualTable rows={previewQ.data} />
        ) : (
          <div className="text-gray-500">No rows.</div>
        )}
      </div>
    </div>
  );
}
