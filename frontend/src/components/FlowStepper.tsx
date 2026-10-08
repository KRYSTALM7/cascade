import type { ActionDetail } from "../api/types";

type StepState = "done" | "current" | "skipped" | "stopped" | "pending";

const DOT: Record<StepState, string> = {
  done: "bg-emerald-400 text-slate-950",
  current: "bg-amber-400 text-slate-950 ring-4 ring-amber-400/20",
  skipped: "bg-slate-700 text-slate-300",
  stopped: "bg-rose-500 text-white",
  pending: "bg-slate-800 text-slate-500 ring-1 ring-slate-700",
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

/** Where the judge is in the story. Light on purpose: a breadcrumb, not a wizard. */
export function FlowStepper({ detail }: { detail: ActionDetail }) {
  const decision = detail.decision?.decision;
  const steps: { id: string; label: string; state: StepState; note?: string }[] = [
    { id: "step-proposed", label: "Proposed action", state: "done" },
    { id: "step-blast", label: "Simulation", state: "done", note: "nothing executed" },
    { id: "step-blast", label: "Blast radius", state: "done" },
    { id: "step-graph", label: "Consequence graph", state: "done" },
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
    <nav aria-label="Progress" className="overflow-x-auto">
      <ol className="flex min-w-max items-start gap-1">
        {steps.map((s, i) => (
          <li key={s.label} className="flex items-start" data-testid={`flow-${s.label}`} data-state={s.state}>
            <a href={`#${s.id}`} className="group flex items-start gap-2 rounded-md px-1.5 py-1 hover:bg-slate-900">
              <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold ${DOT[s.state]}`} aria-hidden>
                {ICON[s.state]}
              </span>
              <span className="leading-tight">
                <span className={`block text-xs font-medium ${s.state === "pending" ? "text-slate-500" : "text-slate-200"}`}>{s.label}</span>
                {s.note && <span className="block text-[10px] text-slate-500">{s.note}</span>}
              </span>
            </a>
            {i < steps.length - 1 && (
              <span aria-hidden className="mx-1 mt-2.5 h-px w-5 bg-slate-700" />
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
