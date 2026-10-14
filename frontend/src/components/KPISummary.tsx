import type { ActionDetail } from "../api/types";
import { inrShort } from "../lib/format";

/** KPI summary strip at the top of results */
export function KPISummary({ detail }: { detail: ActionDetail }) {
  const { report, risk, decision } = detail;
  if (!report || !risk || !decision) return null;

  const radius = report.blast_radius;
  const dec = decision.decision;
  
  // Semantic colors for status
  const statusColors = {
    AUTO_APPROVED: "bg-emerald-50 text-emerald-800 border-emerald-200",
    APPROVAL_REQUIRED: "bg-amber-50 text-amber-800 border-amber-200",
    BLOCKED: "bg-rose-50 text-rose-800 border-rose-200",
  };

  const riskColors = {
    LOW: "text-emerald-700",
    MEDIUM: "text-amber-700",
    HIGH: "text-orange-700",
    CRITICAL: "text-rose-700",
  };

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-5 mb-6">
      {/* Agents Affected */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Agents</div>
        <div className="mt-1 text-2xl lg:text-3xl font-bold tabular-nums text-slate-900">{radius.agent_count}</div>
        <div className="mt-1 text-xs text-slate-600 whitespace-nowrap">affected</div>
      </div>

      {/* Downstream Actions */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Actions</div>
        <div className="mt-1 text-2xl lg:text-3xl font-bold tabular-nums text-slate-900">{radius.downstream_actions}</div>
        <div className="mt-1 text-xs text-slate-600 whitespace-nowrap">downstream</div>
      </div>

      {/* Financial Exposure */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Exposure</div>
        <div className="mt-1 text-xl lg:text-2xl font-bold tabular-nums text-amber-700 whitespace-nowrap">{inrShort(radius.money_out)}</div>
        <div className="mt-1 text-xs text-slate-600 whitespace-nowrap">moves out</div>
      </div>

      {/* Risk Level + Score */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Risk</div>
        <div className={`mt-1 text-xl lg:text-2xl font-bold tabular-nums ${riskColors[risk.level]} whitespace-nowrap`}>
          {risk.level}
        </div>
        <div className="mt-1 text-xs text-slate-600">{risk.score}/100</div>
      </div>

      {/* Status - spans 2 cols on mobile */}
      <div className="col-span-2 lg:col-span-1 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Decision</div>
        <div className={`mt-2 inline-flex items-center rounded-lg border px-3 py-1 text-base lg:text-sm font-semibold ${statusColors[dec]} whitespace-nowrap`}>
          {dec === "AUTO_APPROVED" ? "AUTO‑APPROVED" : dec === "APPROVAL_REQUIRED" ? "APPROVAL REQ'D" : "BLOCKED"}
        </div>
      </div>
    </div>
  );
}
