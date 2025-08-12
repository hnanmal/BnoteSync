import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listStdReleases, getStdTree } from "../shared/api/std";

function TreeNode({ node }) {
  const [open, setOpen] = useState(true);
  const hasChildren = node.children && node.children.length > 0;
  return (
    <div className="ml-3">
      <div className="flex items-center gap-2">
        {hasChildren ? (
          <button className="text-sm px-1 py-0.5 border rounded" onClick={() => setOpen((v) => !v)}>
            {open ? "−" : "+"}
          </button>
        ) : (
          <span className="w-5 inline-block" />
        )}
        <span className="font-medium">{node.name}</span>
        <span className="text-gray-400 text-xs">({node.std_node_uid})</span>
      </div>
      {open && hasChildren && (
        <div className="mt-1">
          {node.children.map((c) => (
            <TreeNode key={c.std_node_uid} node={c} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function StandardsPage() {
  const releasesQ = useQuery({ queryKey: ["std","releases"], queryFn: listStdReleases });
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => {
    if (releasesQ.data?.length && !selectedId) setSelectedId(releasesQ.data[0].id);
  }, [releasesQ.data, selectedId]);

  const treeQ = useQuery({
    enabled: !!selectedId,
    queryKey: ["std","tree", selectedId],
    queryFn: () => getStdTree(selectedId),
  });

  return (
    <div className="space-y-4">
      <div className="p-4 bg-white rounded shadow flex items-center gap-3">
        <div className="font-semibold">Release</div>
        <select
          className="border rounded px-2 py-1"
          value={selectedId ?? ""}
          onChange={(e) => setSelectedId(Number(e.target.value))}
        >
          {releasesQ.data?.map((r) => (
            <option key={r.id} value={r.id}>{r.version}</option>
          ))}
        </select>

        <button
          onClick={async () => {
            // 개발 편의: 백엔드의 데모 시드 호출
            await fetch(`${import.meta.env.VITE_API_BASE || "http://localhost:8000"}/api/std/dev/seed-demo`, { method: "POST" });
            releasesQ.refetch();
          }}
          className="ml-2 text-sm px-2 py-1 rounded border"
          title="개발용 샘플 데이터 추가"
        >
          Seed demo
        </button>
      </div>

      <div className="p-4 bg-white rounded shadow">
        <h3 className="font-semibold mb-2">Tree</h3>
        {treeQ.isLoading ? <div>Loading...</div> : null}
        {treeQ.data?.length ? (
          <div>
            {treeQ.data.map((n) => <TreeNode key={n.std_node_uid} node={n} />)}
          </div>
        ) : (
          <div className="text-gray-500">No nodes.</div>
        )}
      </div>
    </div>
  );
}
