import { useEffect, useRef, useState } from "react";

/** 테이블 컬럼 리사이즈 훅 (localStorage에 per-tableId로 저장) */
export function useResizableColumns(tableId, { defaultWidth = 160 } = {}) {
  const [widths, setWidths] = useState({});
  const dragRef = useRef(null);

  // restore
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`colw:${tableId}`);
      if (raw) setWidths(JSON.parse(raw));
    } catch {}
  }, [tableId]);

  // persist
  useEffect(() => {
    try {
      localStorage.setItem(`colw:${tableId}`, JSON.stringify(widths));
    } catch {}
  }, [tableId, widths]);

  const onMouseDown = (key, e, min = 60) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = Number(widths[key] ?? defaultWidth);

    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      const next = Math.max(min, startW + dx);
      setWidths((w) => ({ ...w, [key]: next }));
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      dragRef.current = null;
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    dragRef.current = { key };
  };

  return { widths, onMouseDown };
}

/** 헤더 셀(TH) + 드래그 핸들 */
export function ResizableTH({ colKey, children, widths, onMouseDown, min = 60, className = "" }) {
  const w = widths[colKey];
  return (
    <th
      className={`relative p-2 text-left whitespace-nowrap ${className}`}
      style={{ width: w ? `${w}px` : undefined, minWidth: min }}
    >
      <div className="pr-2">{children}</div>
      <div
        className="absolute top-0 right-0 h-full w-1 cursor-col-resize hover:bg-gray-300"
        onMouseDown={(e) => onMouseDown(colKey, e, min)}
        title="Drag to resize"
      />
    </th>
  );
}

/** 선택적으로 사용할 수 있는 colgroup 헬퍼 */
export function ResizableColgroup({ columns, widths }) {
  return (
    <colgroup>
      {columns.map((k) => (
        <col key={k} style={{ width: widths[k] ? `${widths[k]}px` : undefined }} />
      ))}
    </colgroup>
  );
}
