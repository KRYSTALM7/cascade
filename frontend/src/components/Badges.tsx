import type { ActionStatus, Decision, RiskLevel } from "../api/types";
import { DECISION_STYLE, LEVEL_STYLE, statusLabel } from "../lib/format";

const pill = "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1";

export function RiskBadge({ level, score }: { level: RiskLevel; score?: number }) {
  return (
    <span className={`${pill} ${LEVEL_STYLE[level]}`}>
      {level}
      {score !== undefined && <span className="ml-1 font-mono">{score}</span>}
    </span>
  );
}

export function DecisionBadge({ decision }: { decision: Decision }) {
  const d = DECISION_STYLE[decision];
  return <span className={`${pill} ${d.style}`}>{d.label}</span>;
}

const STATUS_TONE: Partial<Record<ActionStatus, string>> = {
  EXECUTED: "bg-emerald-50 text-emerald-700 ring-emerald-600/30",
  AUTO_APPROVED: "bg-emerald-50 text-emerald-700 ring-emerald-600/30",
  APPROVED: "bg-sky-50 text-sky-700 ring-sky-600/30",
  PENDING_APPROVAL: "bg-amber-50 text-amber-700 ring-amber-600/30",
  NEEDS_CLARIFICATION: "bg-violet-50 text-violet-700 ring-violet-600/30",
  BLOCKED: "bg-rose-50 text-rose-700 ring-rose-600/30",
  REJECTED: "bg-rose-50 text-rose-700 ring-rose-600/30",
  FAILED: "bg-rose-50 text-rose-700 ring-rose-600/30",
  STALE: "bg-orange-50 text-orange-700 ring-orange-600/30",
  EXPIRED: "bg-orange-50 text-orange-700 ring-orange-600/30",
  PARTIALLY_EXECUTED: "bg-amber-50 text-amber-700 ring-amber-600/30",
};

export function StatusBadge({ status }: { status: ActionStatus }) {
  return (
    <span data-testid="action-status" className={`${pill} ${STATUS_TONE[status] ?? "bg-slate-50 text-slate-700 ring-slate-600/30"}`}>
      {statusLabel(status)}
    </span>
  );
}
