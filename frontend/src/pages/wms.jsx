import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listBatches, previewBatch, ingestWms, validateBatch } from "../shared/api/wms";

function SimpleTable({ rows }) {
  const columns = useMemo(() => {
    const keys = new Set(["row_index", "status"]);
    rows.forEach(r => Object.keys(r.payload_json || {}).forEach(k => keys.add(k)));
    return Array.from(keys);
  }, [rows]);

  return (
    <div className="overflow-auto border rounded">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            {columns.map(c => <th key={c} className="text-left p-2 border-b">{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} className="odd:bg-white even:bg-gray-50">
              {columns.map(c => {
                if (c === "row_index") return <td key={c} className="p-2 border-b">{r.row_index}</td>;
                if (c === "status") return <td key={c} className="p-2 border-b">{r.status}</td>;
                return <td key={c} className="p-2 border-b">{(r.payload_json ?? {})[c] ?? ""}</td>;
              })}
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

  const previewQ = useQuery({
    enabled: !!selected,
    queryKey: ["wms","preview", selected],
    queryFn: () => previewBatch(selected, { limit: 50, offset: 0 }),
  });

  const ingestM = useMutation({
    mutationFn: ingestWms,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wms","batches"] }),
  });

  const validateM = useMutation({
    mutationFn: ({ batchId, fields }) => validateBatch(batchId, fields),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wms","batches"] }),
  });

  return (
    <div className="space-y-4">
      {/* 상단: Ingest / Validate */}
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

          <button
            className="px-3 py-2 rounded border"
            disabled={!selected}
            onClick={() => selected && validateM.mutate({ batchId: selected, fields: ["code", "name", "qty"] })}
            title="필수 필드(code,name,qty) 간단 검증"
          >
            Validate
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
