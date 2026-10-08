import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Suspense, lazy } from "react";
import { NavLink, Navigate, Route, Routes, useNavigate } from "react-router";
import { api } from "./api/endpoints";
import { BackendStatus } from "./components/BackendStatus";
import { UserSwitcher } from "./components/UserProvider";
import { useDeployment } from "./lib/deployment";
import { useUser } from "./lib/userContext";

// Route-level code splitting: the graph libraries only load with the Simulate page.
const SimulatePage = lazy(() => import("./pages/SimulatePage").then((m) => ({ default: m.SimulatePage })));
const DashboardPage = lazy(() => import("./pages/DashboardPage").then((m) => ({ default: m.DashboardPage })));
const AgentsPage = lazy(() => import("./pages/AgentsPage").then((m) => ({ default: m.AgentsPage })));
const EscapeRoomPage = lazy(() => import("./pages/EscapeRoomPage").then((m) => ({ default: m.EscapeRoomPage })));
const AuditPage = lazy(() => import("./pages/AuditPage").then((m) => ({ default: m.AuditPage })));

// The judge-facing path first; the internals stay one click away but visually secondary.
const SECONDARY_NAV = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/agents", label: "Agents & rules" },
  { to: "/escape-room", label: "Escape room" },
  { to: "/audit", label: "Audit" },
];

function ResetButton() {
  const { publicMode } = useDeployment();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const reset = useMutation({
    mutationFn: api.reset,
    onSuccess: () => {
      queryClient.clear();
      void navigate("/simulate");
    },
  });
  if (publicMode) return null; // the backend refuses resets on a public instance
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

const DEMO_NOTICE =
  "Demo mode: seeded demo identities (X-User-Id header). This is not production authentication; do not use it with real data.";

const useDemoMode = () => useDeployment().demoMode;

/** Why the acting persona just changed (e.g. back to the requester before a scenario runs). */
function PersonaNotice() {
  const { notice, setNotice } = useUser();
  if (!notice) return null;
  return (
    <div role="status" data-testid="persona-notice" className="border-t border-sky-500/20 bg-sky-500/10">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-6 py-1.5 text-xs text-sky-100">
        <span>{notice}</span>
        <button type="button" onClick={() => setNotice(null)} className="ml-auto text-sky-300 hover:text-white" aria-label="Dismiss">
          ✕
        </button>
      </div>
    </div>
  );
}

/** Demo identities are an assertion, not authentication: say so whenever the backend runs in demo mode. */
function DemoModePill() {
  if (!useDemoMode()) return null;
  return (
    <a
      href="#demo-mode"
      title={DEMO_NOTICE}
      className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-medium text-amber-200 hover:bg-amber-500/20"
    >
      Demo mode
    </a>
  );
}

function DemoModeNotice() {
  const demo = useDemoMode();
  return (
    <div id="demo-mode" role="note" aria-label="Demo environment" className="mx-auto max-w-7xl px-6 pb-8 text-center text-xs text-slate-500">
      Demo environment — use synthetic data only.
      {demo && <span className="block text-amber-200/70">{DEMO_NOTICE}</span>}
    </div>
  );
}

export default function App() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3">
          <NavLink to="/simulate" className="block">
            <div className="text-lg font-semibold tracking-tight">
              Cascade<span className="text-sky-400">.</span>
            </div>
            <div className="text-[11px] text-slate-400">What happens if this agent acts?</div>
          </NavLink>
          <nav className="flex flex-wrap items-center gap-1 text-sm">
            <NavLink
              to="/simulate"
              className={({ isActive }) => `rounded-md px-3 py-1.5 font-medium ${isActive ? "bg-sky-500/15 text-sky-200 ring-1 ring-sky-400/40" : "text-slate-200 hover:text-white"}`}
            >
              Simulate
            </NavLink>
            <span aria-hidden className="mx-2 h-4 w-px bg-slate-800" />
            {SECONDARY_NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) => `rounded-md px-2 py-1 text-xs ${isActive ? "bg-slate-800 text-white" : "text-slate-500 hover:text-slate-200"}`}
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <UserSwitcher />
            <ResetButton />
            <DemoModePill />
            <BackendStatus />
          </div>
        </div>
        <PersonaNotice />
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
      <DemoModeNotice />
    </div>
  );
}
