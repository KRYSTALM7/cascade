import { Suspense, lazy, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router";
import { useUser } from "./lib/userContext";

const LandingPage = lazy(() => import("./pages/LandingPage").then((m) => ({ default: m.LandingPage })));
const SimulatePage = lazy(() => import("./pages/SimulatePage").then((m) => ({ default: m.SimulatePage })));
const DashboardPage = lazy(() => import("./pages/DashboardPage").then((m) => ({ default: m.DashboardPage })));
const AgentsPage = lazy(() => import("./pages/AgentsPage").then((m) => ({ default: m.AgentsPage })));
const AuditPage = lazy(() => import("./pages/AuditPage").then((m) => ({ default: m.AuditPage })));

const NAV_ITEMS = [
  { to: "/simulate", label: "Simulate" },
  { to: "/dashboard", label: "Dashboard" },
  { to: "/agents", label: "Agents & Rules" },
  { to: "/audit", label: "Audit" },
];

const MERCORA_URL = "https://demo-polish-web---mercora-web-gp5ciyqy6a-el.a.run.app/dashboard";

function UserSwitcher() {
  const { userId, setUserId, setNotice } = useUser();
  const users = [
    { id: "ops-ravi", name: "Ravi", role: "Operator" },
    { id: "approver-asha", name: "Asha", role: "Approver" },
    { id: "approver-dev", name: "Dev", role: "Approver" },
    { id: "viewer-kim", name: "Kim", role: "Viewer" },
  ];
  


  return (
    <select
      value={userId}
      onChange={(e) => {
        setUserId(e.target.value);
        setNotice(null);
      }}
      className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 hover:border-slate-300 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 max-w-[150px] lg:max-w-none min-h-[44px] truncate"
      title={`${users.find(u => u.id === userId)?.name} (${users.find(u => u.id === userId)?.role})`}
    >
      {users.map((u) => (
        <option key={u.id} value={u.id}>
          {u.name} ({u.role})
        </option>
      ))}
    </select>
  );
}

function ReloadButton() {
  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      title="Reload page"
      className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900 min-h-[44px] min-w-[44px]"
    >
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
    </button>
  );
}

function MobileNav({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  if (!isOpen) return null;
  
  return (
    <div className="lg:hidden fixed inset-0 z-50 bg-black/50" onClick={onClose}>
      <div className="absolute right-0 top-0 h-full w-64 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="p-4">
          <button
            onClick={onClose}
            className="mb-4 ml-auto flex h-11 w-11 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"
            aria-label="Close menu"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <nav className="flex flex-col gap-1">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={onClose}
                className={({ isActive }) =>
                  `rounded-lg px-4 py-3 text-base font-medium transition-colors whitespace-nowrap min-h-[48px] flex items-center ${
                    isActive ? "bg-primary-50 text-primary-600" : "text-slate-700 hover:bg-slate-100"
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
            <a
              href={MERCORA_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onClose}
              className="rounded-lg px-4 py-3 text-base font-medium transition-colors whitespace-nowrap min-h-[48px] flex items-center gap-2 text-slate-700 hover:bg-slate-100"
            >
              Mercora
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          </nav>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  
  return (
    <div className="flex min-h-screen flex-col overflow-x-hidden" style={{ backgroundColor: '#F8FAFD' }}>
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white shadow-sm">
        <div className="mx-auto flex h-16 lg:h-16 max-w-7xl items-center justify-between gap-3 px-4 md:px-6 lg:px-8">
          <NavLink to="/" className="flex items-center gap-2 flex-shrink-0">
            <img src="/cascade_logo.png" alt="Cascade" className="h-8 w-8" />
            <span className="text-lg font-bold text-slate-900">Cascade</span>
          </NavLink>

          {/* Desktop nav */}
          <nav className="hidden lg:flex items-center gap-1">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
                    isActive ? "bg-primary-50 text-primary-600" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
            <a
              href={MERCORA_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap text-slate-600 hover:bg-slate-100 hover:text-slate-900 inline-flex items-center gap-1"
            >
              Mercora
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          </nav>

          <div className="flex items-center gap-2 lg:gap-3">
            <UserSwitcher />
            <ReloadButton />
            
            {/* Mobile hamburger */}
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 min-h-[44px] min-w-[44px]"
              aria-label="Open menu"
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-menu"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          </div>
        </div>
      </header>
      
      <MobileNav isOpen={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)} />

      <main className="flex-1 mx-auto w-full max-w-7xl px-4 md:px-6 lg:px-8">
        <Suspense fallback={<div className="flex min-h-[400px] items-center justify-center"><p className="text-slate-500">Loading…</p></div>}>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/simulate" element={<div className="py-8"><SimulatePage /></div>} />
            <Route path="/dashboard" element={<div className="py-8"><DashboardPage /></div>} />
            <Route path="/agents" element={<div className="py-8"><AgentsPage /></div>} />
            <Route path="/audit" element={<div className="py-8"><AuditPage /></div>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </main>

      <footer className="border-t border-slate-200 bg-white mt-auto">
        <div className="mx-auto max-w-7xl px-4 py-6 md:px-6 lg:px-8">
          <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <div className="text-center sm:text-left">
              <p className="text-sm text-slate-600">
                <strong className="text-slate-900">Cascade</strong> — Before AI acts, see the consequences.
              </p>
            </div>
            <div className="text-center sm:text-right">
              <a
                href={MERCORA_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Go to Mercora Operations
              </a>
            </div>
          </div>
          <div className="mt-3 text-center text-xs text-slate-500">
            Mercora runs the business. Cascade helps keep autonomous actions from putting it at risk.
          </div>
          <div className="mt-3 text-center text-xs text-slate-400 border-t border-slate-100 pt-3">
            © 2026 Sujan Kumar (@KRYSTALM7). All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
