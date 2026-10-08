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
      <span aria-hidden className={applied ? "text-emerald-300" : failed ? "text-rose-300" : "text-slate-500"}>
        {applied ? "✓" : failed ? "✗" : "–"}
      </span>
      <span className={applied ? "text-slate-100" : failed ? "text-rose-200" : "text-slate-400"}>
        {applied ? doneText(step.tool_id) : `${toolTitle(step.tool_id)} ${failed ? "failed" : "skipped"}`}
      </span>
      <span className="text-xs text-slate-500">{agentName(step.agent_id)}</span>
      {step.error && <span className="text-xs text-rose-300">{step.error}</span>}
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
    <section id="step-execution" aria-label="Execution" className="scroll-mt-24 space-y-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-400">Execution</div>
        {execution && (
          <span className="text-xs text-slate-500">
            Attempt {execution.attempt}: <span className="font-medium text-slate-200">{execution.status}</span>
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
          {execution.error && <p className="text-sm text-rose-300">{execution.error.message}</p>}
        </>
      ) : (
        <p data-testid="nothing-ran" className="text-slate-300">
          {WILL_NOT_RUN.has(action.status)
            ? "Nothing will run. NovaCart's data is unchanged."
            : "Nothing has run yet. Cascade has only simulated — NovaCart's data is unchanged."}
        </p>
      )}

      {orderId && report && <OrderState orderId={orderId} report={report} />}

      <div className="flex flex-wrap items-center gap-4 text-sm">
        {executed && !publicMode && (action.raw_text || action.tool_id) && (
          <button
            type="button"
            onClick={() => reset.mutate(action)}
            disabled={reset.isPending}
            className="rounded-lg border border-slate-600 px-3 py-1.5 text-slate-200 hover:border-slate-400 disabled:opacity-50"
          >
            {reset.isPending ? "Resetting…" : "Reset demo data & run this again"}
          </button>
        )}
        <Link to="/audit" className="text-sky-300 hover:underline">
          View the audit trail →
        </Link>
      </div>
      {reset.error && <ErrorBanner error={reset.error} />}
    </section>
  );
}
