import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 좌측 패널 폭 드래그 훅 (접기 지원)
 * - localStorage로 폭/상태 보존
 */
export function useResizablePane(
  storageKey = "ui.sidebar.width",
  {
    initial = 80,     // 최초 폭
    min = 0,           // ← 접힘을 허용하려면 0
    max = 520,
    disabledBelow = 640,
    collapsible = true,
    collapseAt = 12,   // ← 이 값 이하로 드래그 시 0으로 스냅
  } = {}
) {
  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem(storageKey));
    return Number.isFinite(saved) ? saved : initial;
  });

  // 마지막 비접힘 폭 (펼치기 복원용)
  const lastExpandedRef = useRef(width > 0 ? width : (Number(localStorage.getItem(`${storageKey}:last`)) || initial));

  const drag = useRef({ startX: 0, startW: width, dragging: false });
  const isDisabled = typeof window !== "undefined" && window.innerWidth < disabledBelow;

  const onMouseMove = useCallback((e) => {
    const { startX, startW } = drag.current;
    let w = startW + (e.clientX - startX);

    // 클램프 (접힘 허용 시 하한 0)
    if (w < 0) w = 0;
    if (w > max) w = max;

    // 스냅-투-제로
    if (collapsible && w > 0 && w < collapseAt) w = 0;

    setWidth(w);
  }, [max, collapsible, collapseAt]);

  const endDrag = useCallback(() => {
    if (!drag.current.dragging) return;
    drag.current.dragging = false;

    document.body.classList.remove("select-none", "cursor-col-resize");
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", endDrag);

    // 상태 저장
    localStorage.setItem(storageKey, String(width));
    if (width > 0) {
      lastExpandedRef.current = width;
      localStorage.setItem(`${storageKey}:last`, String(width));
    }
  }, [onMouseMove, storageKey, width]);

  const onMouseDown = useCallback((e) => {
    if (isDisabled) return;
    drag.current.startX = e.clientX;
    drag.current.startW = width;
    drag.current.dragging = true;

    document.body.classList.add("select-none", "cursor-col-resize");
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", endDrag);
  }, [width, onMouseMove, endDrag, isDisabled]);

  // 더블클릭으로 접기/펼치기 토글
  const toggleCollapse = useCallback(() => {
    setWidth((w) => {
      if (w === 0) {
        const restore = Math.min(Math.max(lastExpandedRef.current || initial, 120), max);
        localStorage.setItem(storageKey, String(restore));
        return restore;
      } else {
        lastExpandedRef.current = w;
        localStorage.setItem(`${storageKey}:last`, String(w));
        localStorage.setItem(storageKey, "0");
        return 0;
      }
    });
  }, [initial, max, storageKey]);

  // ✅ 새로 추가: "최초 폭(initial)"로 복원
  const restoreToInitial = useCallback(() => {
    const restore = Math.min(Math.max(initial, 120), max);
    lastExpandedRef.current = restore;
    setWidth(restore);
    localStorage.setItem(storageKey, String(restore));
    localStorage.setItem(`${storageKey}:last`, String(restore));
  }, [initial, max, storageKey]);

  // 리사이즈 시 안전 클램프
  useEffect(() => {
    const onResize = () => setWidth((w) => {
      if (w === 0) return 0;
      return Math.min(Math.max(w, 0), max);
    });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [max]);

  return {
    width,
    setWidth,
    onMouseDown,
    toggleCollapse,
    restoreToInitial,
    isCollapsed: width === 0,
    isDisabled,
    min,
    max,
  };
}
