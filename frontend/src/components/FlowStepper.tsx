import type { ActionDetail } from "../api/types";

type StepState = "done" | "current" | "skipped" | "stopped" | "pending";

const DOT: Record<StepState, string> = {
  done: "bg-emerald-500 text-white",
  current: "bg-amber-400 text-slate-900 ring-2 ring-amber-400/30",
  skipped: "bg-slate-200 text-slate-500",
  stopped: "bg-rose-500 text-white",
  pending: "bg-slate-100 text-slate-400 border border-slate-200",
};

const ICON: Record<StepState, string> = { done: "✓", current: "•", skipped: "–", stopped: "✕", pending: "" };

function approvalStep(detail: ActionDetail): [StepState, string] {
  const s = detail.action.status;
  if (s === "PENDING_APPROVAL") return ["current", "waiting for a human"];
  if (s === "BLOCKED") return ["stopped", "blocked by policy"];
  if (s === "REJECTED") return ["stopped", "rejected"];
  if (s === "EXPIRED") return ["stopped", "expired"];
  if (s === "STALE") return ["stopped", "state changed"];
  if (detail.approval?.decided_by) return ["done", `approved by ${detail.approval.decided_by}`];
  if (detail.decision?.decision === "AUTO_APPROVED") return ["skipped", "not needed"];
  return ["pending", ""];
}

function executionStep(detail: ActionDetail): [StepState, string] {
  const s = detail.action.status;
  if (s === "EXECUTED") return ["done", "applied"];
  if (s === "PARTIALLY_EXECUTED") return ["done", "partially applied"];
  if (s === "FAILED") return ["stopped", "failed"];
  if (s === "EXECUTING") return ["current", "running"];
  if (s === "APPROVED" || s === "AUTO_APPROVED") return ["current", "ready to run"];
  if (s === "BLOCKED" || s === "REJECTED" || s === "EXPIRED") return ["skipped", "will not run"];
  return ["pending", "nothing has run"];
}

/** Compact progress stepper showing the simulation stages */
export function FlowStepper({ detail }: { detail: ActionDetail }) {
  const decision = detail.decision?.decision;
  const steps: { id: string; label: string; state: StepState; note?: string }[] = [
    { id: "step-proposed", label: "Proposed", state: "done" },
    { id: "step-blast", label: "Simulation", state: "done" },
    { id: "step-blast", label: "Blast radius", state: "done" },
    { id: "step-graph", label: "Consequences", state: "done" },
    {
      id: "step-decision",
      label: "Risk & decision",
      state: decision === "BLOCKED" ? "stopped" : "done",
      note: decision ? decision.replace(/_/g, " ").toLowerCase() : undefined,
    },
  ];
  const [approval, approvalNote] = approvalStep(detail);
  const [execution, executionNote] = executionStep(detail);
  steps.push({ id: "step-approval", label: "Approval", state: approval, note: approvalNote });
  steps.push({ id: "step-execution", label: "Execution", state: execution, note: executionNote });

  return (
    <nav aria-label="Progress" className="overflow-x-auto pb-1">
      <ol className="flex min-w-max items-start gap-0.5">
        {steps.map((s, i) => (
          <li key={s.label} className="flex items-start" data-testid={`flow-${s.label}`} data-state={s.state}>
            <a href={`#${s.id}`} className="group flex items-start gap-1.5 rounded-md px-2 py-1.5 hover:bg-slate-50 transition-colors">
              <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] font-bold ${DOT[s.state]}`} aria-hidden>
                {ICON[s.state]}
              </span>
              <span className="leading-tight">
                <span className={`block text-[11px] font-medium ${s.state === "pending" ? "text-slate-400" : "text-slate-700"}`}>{s.label}</span>
                {s.note && <span className="block text-[9px] text-slate-500">{s.note}</span>}
              </span>
            </a>
            {i < steps.length - 1 && (
              <span aria-hidden className="mx-0.5 mt-2.5 h-px w-3 bg-slate-200" />
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
