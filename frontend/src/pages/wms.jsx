import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
// import { listBatches, previewBatch, ingestWms, validateBatch } from "../shared/api/wms";
import { uploadExcel, listBatches, previewBatch, ingestWms, validateBatch, deleteBatch } from "../shared/api/wms";
import { useRef } from "react";

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

function SimpleTable({ rows }) {
  // rows[*].payload_json 에는 top-level(code,name,qty,unit,group_code) + _raw(원본전체)
  const flatRows = rows.map(r => {
    const p = r.payload_json || {};
    const flattened = { ...p, ...(p._raw || {}) }; // ✅ 원본 열 펼침
    // 원본이 표시되면 _raw 키 자체는 제거
    delete flattened._raw;
    return { row_index: r.row_index, status: r.status, ...flattened };
  });

  const columns = Array.from(
    new Set(
      flatRows.reduce((acc, r) => {
        Object.keys(r).forEach(k => acc.push(k));
        return acc;
      }, [])
    )
  );

  return (
    <div className="overflow-auto border rounded">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            {columns.map(c => <th key={c} className="text-left p-2 border-b">{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {flatRows.map((r, idx) => (
            <tr key={idx} className="odd:bg-white even:bg-gray-50">
              {columns.map(c => (
                <td key={c} className="p-2 border-b">
                  {r[c] == null ? "" : String(r[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


export default function WmsPage() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState(null);

  const batchesQ = useQuery({ queryKey: ["wms","batches"], queryFn: listBatches, refetchOnWindowFocus: false });

  const [pageSize, setPageSize] = useState(50); // 50 | 100 | 500 | 'ALL'
  const isAll = pageSize === 'ALL';

  const previewQ = useQuery({
    enabled: !!selected,
    queryKey: ["wms","preview", selected, pageSize],
    queryFn: () => previewBatch(
      selected,
      { limit: isAll ? undefined : pageSize, offset: 0 } // ✅ All이면 limit 미전달
    ),
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
        <h3 className="font-semibold mb-2">Preview {selected ? `#${selected}` : ""}</h3>
        {previewQ.isLoading ? <div>Loading...</div> : null}
        {previewQ.data?.length ? <SimpleTable rows={previewQ.data} /> : <div className="text-gray-500">No rows.</div>}
      </div>
    </div>
  );
}
