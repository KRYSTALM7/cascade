import type { ActionStatus, Decision, RiskLevel } from "../api/types";
import { DECISION_STYLE, LEVEL_STYLE, statusLabel } from "../lib/format";

const pill = "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1";

export function RiskBadge({ level, score }: { level: RiskLevel; score?: number }) {
  return (
    <span className={`${pill} ${LEVEL_STYLE[level]}`}>
      {level}
      {score !== undefined && <span className="ml-1 font-mono opacity-80">{score}</span>}
    </span>
  );
}

export function DecisionBadge({ decision }: { decision: Decision }) {
  const d = DECISION_STYLE[decision];
  return <span className={`${pill} ${d.style}`}>{d.label}</span>;
}

const STATUS_TONE: Partial<Record<ActionStatus, string>> = {
  EXECUTED: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/40",
  AUTO_APPROVED: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30",
  APPROVED: "bg-sky-500/15 text-sky-300 ring-sky-500/40",
  PENDING_APPROVAL: "bg-amber-500/15 text-amber-300 ring-amber-500/40",
  NEEDS_CLARIFICATION: "bg-violet-500/15 text-violet-300 ring-violet-500/40",
  BLOCKED: "bg-rose-500/15 text-rose-300 ring-rose-500/40",
  REJECTED: "bg-rose-500/10 text-rose-300 ring-rose-500/30",
  FAILED: "bg-rose-500/15 text-rose-300 ring-rose-500/40",
  STALE: "bg-orange-500/15 text-orange-300 ring-orange-500/40",
  EXPIRED: "bg-orange-500/15 text-orange-300 ring-orange-500/40",
  PARTIALLY_EXECUTED: "bg-amber-500/15 text-amber-300 ring-amber-500/40",
};

export function StatusBadge({ status }: { status: ActionStatus }) {
  return (
    <span data-testid="action-status" className={`${pill} ${STATUS_TONE[status] ?? "bg-slate-500/15 text-slate-300 ring-slate-500/40"}`}>
      {statusLabel(status)}
    </span>
  );
}
