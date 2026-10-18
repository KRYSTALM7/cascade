import { Link } from "react-router";
import type { ActionDetail, ExecutionStep } from "../api/types";
import { useResetDemo } from "../lib/demoActions";
import { useDeployment } from "../lib/deployment";
import { agentName, doneText, toolTitle } from "../lib/format";
import { ErrorBanner } from "./ErrorBanner";
import { OrderState } from "./OrderState";

const WILL_NOT_RUN = new Set(["BLOCKED", "REJECTED", "EXPIRED"]);

function Step({ step }: { step: ExecutionStep }) {
  const applied = step.status === "APPLIED";
  const failed = step.status === "FAILED";
  return (
    <li
      data-testid={`exec-step-${step.node_id}`}
      title={`${step.tool_id} · ${step.status.toLowerCase()}${step.error ? ` · ${step.error}` : ""}`}
      className="flex items-baseline gap-2 text-sm"
    >
      <span aria-hidden className={applied ? "text-emerald-700" : failed ? "text-rose-700" : "text-slate-400"}>
        {applied ? "✓" : failed ? "✗" : "–"}
      </span>
      <span className={applied ? "text-slate-900" : failed ? "text-rose-800" : "text-slate-600"}>
        {applied ? doneText(step.tool_id) : `${toolTitle(step.tool_id)} ${failed ? "failed" : "skipped"}`}
      </span>
      <span className="text-xs text-slate-600">{agentName(step.agent_id)}</span>
      {step.error && <span className="text-xs text-rose-700">{step.error}</span>}
    </li>
  );
}

/** What actually ran (or that nothing has), plus the live before/after of the order. */
export function Execution({ detail }: { detail: ActionDetail }) {
  const { action, report } = detail;
  const execution = detail.executions.at(-1);
  const reset = useResetDemo();
  const { publicMode } = useDeployment();
  const orderId = typeof action.parameters.order_id === "string" ? action.parameters.order_id : null;
  const executed = action.status === "EXECUTED" || action.status === "PARTIALLY_EXECUTED";

  return (
    <section id="step-execution" aria-label="Execution" className="scroll-mt-24 space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col md:flex-row md:items-baseline md:justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">Execution</div>
        {execution && (
          <span className="text-xs text-slate-600">
            Attempt {execution.attempt}: <span className="font-medium text-slate-900">{execution.status}</span>
          </span>
        )}
      </div>

      {execution ? (
        <>
          <ol className="space-y-1" aria-label="Execution steps">
            {execution.steps.map((s) => (
              <Step key={s.node_id} step={s} />
            ))}
          </ol>
          {execution.error && <p className="text-sm text-rose-700">{execution.error.message}</p>}
        </>
      ) : (
        <>
          <div className="flex flex-col md:flex-row md:items-center gap-2">
            <p data-testid="nothing-ran" className="text-slate-900">
              {WILL_NOT_RUN.has(action.status)
                ? "Nothing will run. NovaCart's data is unchanged."
                : "Nothing has run yet. Cascade has only simulated — NovaCart's data is unchanged."}
            </p>
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800 self-start md:self-center">Simulation only. No changes made</span>
          </div>
        </>
      )}

      {orderId && report && <OrderState orderId={orderId} report={report} />}

      <div className="flex flex-wrap items-center gap-4 text-sm">
        {executed && !publicMode && (action.raw_text || action.tool_id) && (
          <button
            type="button"
            onClick={() => reset.mutate(action)}
            disabled={reset.isPending}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-slate-700 hover:border-slate-400 hover:bg-slate-50 min-h-[44px]"
          >
            {reset.isPending ? "Resetting…" : "Reset & run this again"}
          </button>
        )}
        <Link to="/audit" className="font-medium text-indigo-600 hover:underline min-h-[44px] inline-flex items-center">
          View the audit trail →
        </Link>
      </div>
      {reset.error && <ErrorBanner error={reset.error} />}
    </section>
  );
}
