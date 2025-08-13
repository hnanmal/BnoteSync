import { Outlet, Link, useLocation } from "react-router-dom";

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
  return (
    <div className="min-h-screen grid grid-cols-[240px_1fr] grid-rows-[56px_1fr]">
      {/* Top Bar */}
      <header className="col-span-2 h-14 flex items-center justify-between px-4 bg-white border-b">
        <div className="font-bold">Bnote:Sync</div>
        <div className="text-sm text-gray-500">dev</div>
      </header>

      {/* Left Nav */}
      <aside className="border-r bg-white p-2">
        <nav className="space-y-1">
          <NavLink to="/standards">Standards</NavLink>
          <NavLink to="/standards/gwm">Std-GWM</NavLink>
          <NavLink to="/projects/1">Projects</NavLink>
          <NavLink to="/calc">Calc</NavLink>
          <NavLink to="/wms">WMS</NavLink>
          <NavLink to="/reporting">Reporting</NavLink>
          <NavLink to="/auth/login">Login</NavLink>
        </nav>
      </aside>

      {/* Main */}
      <main className="p-4">
        <div className="max-w-5xl mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
