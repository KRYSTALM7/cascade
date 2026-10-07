import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Suspense, lazy } from "react";
import { NavLink, Navigate, Route, Routes, useNavigate } from "react-router";
import { api } from "./api/endpoints";
import { BackendStatus } from "./components/BackendStatus";
import { UserSwitcher } from "./components/UserProvider";

// Route-level code splitting: the graph libraries only load with the Simulate page.
const SimulatePage = lazy(() => import("./pages/SimulatePage").then((m) => ({ default: m.SimulatePage })));
const DashboardPage = lazy(() => import("./pages/DashboardPage").then((m) => ({ default: m.DashboardPage })));
const AgentsPage = lazy(() => import("./pages/AgentsPage").then((m) => ({ default: m.AgentsPage })));
const EscapeRoomPage = lazy(() => import("./pages/EscapeRoomPage").then((m) => ({ default: m.EscapeRoomPage })));
const AuditPage = lazy(() => import("./pages/AuditPage").then((m) => ({ default: m.AuditPage })));

const NAV = [
  { to: "/simulate", label: "Simulate" },
  { to: "/dashboard", label: "Dashboard" },
  { to: "/agents", label: "Agents & rules" },
  { to: "/escape-room", label: "Escape room" },
  { to: "/audit", label: "Audit" },
];

function ResetButton() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const reset = useMutation({
    mutationFn: api.reset,
    onSuccess: () => {
      queryClient.clear();
      void navigate("/simulate");
    },
  });
  return (
    <button
      type="button"
      onClick={() => reset.mutate()}
      disabled={reset.isPending}
      title={reset.error ? String(reset.error) : "Re-seed NovaCart (DEMO_MODE only)"}
      className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-400 hover:text-slate-100 disabled:opacity-50"
    >
      {reset.isPending ? "Resetting…" : "Reset demo"}
    </button>
  );
}

export default function App() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3">
          <div>
            <div className="text-lg font-semibold tracking-tight">
              Cascade<span className="text-sky-400">.</span>
            </div>
            <div className="text-[11px] text-slate-500">What happens if we allow this action?</div>
          </div>
          <nav className="flex gap-1 text-sm">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) => `rounded-md px-3 py-1.5 ${isActive ? "bg-slate-800 text-white" : "text-slate-400 hover:text-slate-200"}`}
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <UserSwitcher />
            <ResetButton />
            <BackendStatus />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-6">
        <Suspense fallback={<p className="text-slate-500">Loading…</p>}>
        <Routes>
          <Route path="/" element={<Navigate to="/simulate" replace />} />
          <Route path="/simulate" element={<SimulatePage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/escape-room" element={<EscapeRoomPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="*" element={<Navigate to="/simulate" replace />} />
        </Routes>
        </Suspense>
      </main>
    </div>
  );
}
