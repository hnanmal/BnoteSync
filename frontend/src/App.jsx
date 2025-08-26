import { Outlet, Link, useLocation } from "react-router-dom";
import { useResizablePane } from "./shared/ui/useResizablePane";

function NavLink({ to, children }) {
  const loc = useLocation();
  const active = loc.pathname.startsWith(to);
  return (
    <Link className={`block px-3 py-2 rounded ${active ? "bg-blue-100" : "hover:bg-gray-100"}`} to={to}>
      {children}
    </Link>
  );
}

export default function App() {
  const {
    width, onMouseDown, toggleCollapse, restoreToInitial,
    isCollapsed, isDisabled
  } = useResizablePane("ui.sidebar.width", {
    initial: 150, min: 0, max: 520, disabledBelow: 640,
    collapsible: true, collapseAt: 12,
  });

  const gridCols = `${Math.round(width)}px 6px 1fr`;

  return (
    <div className="min-h-screen grid grid-rows-[56px_1fr]" style={{ gridTemplateColumns: gridCols }}>
      {/* Top Bar */}
      <header className="col-span-3 h-14 flex items-center justify-between px-4 bg-white border-b">
        <div className="font-bold">Bnote:Sync</div>
        <div className="text-sm text-gray-500">dev</div>
      </header>

      {/* Left Nav */}
      <aside className={`bg-white p-2 overflow-auto ${isCollapsed ? "" : "border-r"}`} aria-expanded={!isCollapsed}>
        {!isCollapsed && (
          <nav className="space-y-1">
            <NavLink to="/standards">Standards</NavLink>
            <NavLink to="/standards/gwm">Std-GWM</NavLink>
            <NavLink to="/standards/swm">Std-SWM</NavLink>
            <NavLink to="/projects/1">Projects</NavLink>
            <NavLink to="/calc">Calc</NavLink>
            <NavLink to="/wms">WMS</NavLink>
            <NavLink to="/reporting">Reporting</NavLink>
            <NavLink to="/auth/login">Login</NavLink>
          </nav>
        )}
      </aside>

      {/* Drag Handle + 📑책갈피 탭 */}
      <div
        role="separator"
        aria-orientation="vertical"
        onMouseDown={onMouseDown}
        onDoubleClick={toggleCollapse}
        title={isDisabled ? "좁은 화면: 조절 비활성화" : "드래그로 폭 조절 / 더블클릭 접기·펼치기"}
        className={"relative bg-transparent " + (isDisabled ? "cursor-not-allowed" : "cursor-col-resize")}
      >
        {/* 가이드 라인 */}
        <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-gray-300" />

        {/* ✅ 접힘 상태에서만 보이는 '책갈피 탭' */}
        {isCollapsed && (
          <button
            type="button"
            onClick={restoreToInitial}
            onMouseDown={(e) => e.stopPropagation()} // 드래그 시작 방지
            aria-label="사이드바 펼치기"
            title="사이드바 펼치기"
            className="absolute top-1/2 -translate-y-1/2 -right-2 z-20
                       rounded-r-lg px-2 py-2 shadow bg-blue-600 text-white
                       hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            🔖
          </button>
        )}
      </div>

      {/* Main */}
      <main className="p-4 overflow-auto bg-gray-50">
        <div className="max-w-none mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
