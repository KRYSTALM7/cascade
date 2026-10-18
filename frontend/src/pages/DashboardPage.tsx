import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { api } from "../api/endpoints";
import type { RiskLevel } from "../api/types";
import { RiskBadge, StatusBadge } from "../components/Badges";
import { ErrorBanner } from "../components/ErrorBanner";
import { agentStyle, inr } from "../lib/format";

const LEVELS: RiskLevel[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const LEVEL_BAR: Record<RiskLevel, string> = {
  LOW: "bg-emerald-400",
  MEDIUM: "bg-amber-400",
  HIGH: "bg-orange-500",
  CRITICAL: "bg-rose-500",
};

export function DashboardPage() {
  const actions = useQuery({ queryKey: ["actions"], queryFn: api.actions, refetchInterval: 5000 });
  const list = actions.data ?? [];
  const pending = list.filter((a) => a.status === "PENDING_APPROVAL");
  const counts = LEVELS.map((level) => ({ level, n: list.filter((a) => a.risk_level === level).length }));
  const max = Math.max(1, ...counts.map((c) => c.n));

  return (
    <div className="space-y-6">
      {actions.error && <ErrorBanner error={actions.error} />}
      <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-700">Risk distribution</h2>
          <ul className="mt-4 space-y-3" aria-label="Risk distribution">
            {counts.map(({ level, n }) => (
              <li key={level} className="grid grid-cols-[80px_1fr_32px] items-center gap-3 text-sm">
                <span className="text-slate-700 font-medium">{level}</span>
                <div className="h-3 rounded-full bg-slate-100">
                  <div className={`h-full rounded-full ${LEVEL_BAR[level]}`} style={{ width: `${(n / max) * 100}%` }} />
                </div>
                <span className="text-right font-mono tabular-nums text-slate-900">{n}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-amber-700">Waiting for a human ({pending.length})</h2>
          {pending.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">Nothing pending.</p>
          ) : (
            <ul className="mt-3 divide-y divide-amber-200">
              {pending.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                  <Link to={`/simulate?action=${a.id}`} className="text-slate-900 hover:text-primary-600 hover:underline">
                    {a.title}
                  </Link>
                  <span className="flex items-center gap-3">
                    <span className="font-mono text-sm text-slate-900">{inr(a.money_out)}</span>
                    {a.risk_level && <RiskBadge level={a.risk_level} score={a.risk_score ?? undefined} />}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-700">Recent actions</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider bg-slate-100 border-b border-slate-200">
                <th className="py-2 px-3 font-semibold text-slate-700">Action</th>
                <th className="py-2 px-3 font-semibold text-slate-700">Agent</th>
                <th className="py-2 px-3 font-semibold text-slate-700">Status</th>
                <th className="py-2 px-3 font-semibold text-slate-700">Risk</th>
                <th className="py-2 px-3 text-right font-semibold text-slate-700">Money out</th>
                <th className="py-2 px-3 text-right font-semibold text-slate-700">When</th>
              </tr>
            </thead>
            <tbody>
              {list.map((a) => (
                <tr key={a.id} className="border-b border-slate-200 hover:bg-slate-50 transition-colors">
                  <td className="py-2 px-3 text-slate-900">
                    <Link to={`/simulate?action=${a.id}`} className="hover:text-primary-600 hover:underline">
                      {a.title}
                    </Link>
                    {a.parent_action_id && <span className="ml-2 text-xs text-indigo-600">what-if</span>}
                  </td>
                  <td className="py-2 px-3 font-medium" style={{ color: agentStyle(a.agent_id).color }}>
                    {a.agent_id}
                  </td>
                  <td className="py-2 px-3">
                    <StatusBadge status={a.status} />
                  </td>
                  <td className="py-2 px-3">{a.risk_level ? <RiskBadge level={a.risk_level} score={a.risk_score ?? undefined} /> : "—"}</td>
                  <td className="py-2 px-3 text-right font-mono text-slate-900">{inr(a.money_out)}</td>
                  <td className="py-2 px-3 text-right text-slate-600">{new Date(a.created_at).toLocaleTimeString()}</td>
                </tr>
              ))}
              {list.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-slate-600">
                    No actions yet — <Link to="/simulate" className="text-primary-600 hover:underline">simulate one</Link>.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-2 text-xs text-slate-600 md:hidden">← Scroll to see all columns</div>
      </section>
    </div>
  );
}
