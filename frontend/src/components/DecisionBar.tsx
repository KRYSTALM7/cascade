import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/endpoints";
import type { ActionDetail } from "../api/types";
import { useUser } from "../lib/userContext";
import { DecisionBadge, StatusBadge } from "./Badges";
import { ErrorBanner } from "./ErrorBanner";

const EXECUTABLE = new Set(["AUTO_APPROVED", "APPROVED", "FAILED"]);

/** Human decision + execution. Every rule is enforced by the backend; this only shows the outcome. */
export function DecisionBar({ detail, onChange }: { detail: ActionDetail; onChange: (d: ActionDetail) => void }) {
  const { userId } = useUser();
  const queryClient = useQueryClient();
  const id = detail.action.id;
  const mutation = useMutation({
    mutationFn: (verb: "approve" | "reject" | "execute") => api[verb](userId, id),
    onSuccess: (next) => {
      onChange(next);
      void queryClient.invalidateQueries({ queryKey: ["order"] });
      void queryClient.invalidateQueries({ queryKey: ["actions"] });
    },
  });
  const status = detail.action.status;
  const busy = mutation.isPending;
  const execution = detail.executions.at(-1);

  return (
    <section aria-label="Decision" className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge status={status} />
        {detail.decision && <DecisionBadge decision={detail.decision.decision} />}
        {detail.approval?.status === "PENDING" && (
          <span className="text-xs text-slate-500">approval expires {new Date(detail.approval.expires_at).toLocaleTimeString()}</span>
        )}
        {detail.approval?.decided_by && (
          <span className="text-xs text-slate-400">
            {detail.approval.status.toLowerCase()} by <span className="font-medium text-slate-200">{detail.approval.decided_by}</span>
          </span>
        )}
        <div className="ml-auto flex gap-2">
          {status === "PENDING_APPROVAL" && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => mutation.mutate("reject")}
                className="rounded-lg border border-rose-500/50 px-3 py-1.5 text-sm font-medium text-rose-200 hover:bg-rose-500/10 disabled:opacity-50"
              >
                Reject
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => mutation.mutate("approve")}
                className="rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
              >
                Approve as {userId}
              </button>
            </>
          )}
          {EXECUTABLE.has(status) && (
            <button
              type="button"
              disabled={busy}
              onClick={() => mutation.mutate("execute")}
              className="rounded-lg bg-sky-500 px-3 py-1.5 text-sm font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50"
            >
              {status === "FAILED" ? "Retry execution" : "Execute"}
            </button>
          )}
        </div>
      </div>
      {mutation.error && (
        <div className="mt-3">
          <ErrorBanner error={mutation.error} />
        </div>
      )}
      {execution && (
        <div className="mt-3 text-sm">
          <div className="text-slate-400">
            Attempt {execution.attempt}: <span className="font-medium text-slate-200">{execution.status}</span>
            {execution.error && <span className="ml-2 text-rose-300">{execution.error.message}</span>}
          </div>
          <ol className="mt-1 flex flex-wrap gap-1.5">
            {execution.steps.map((s) => (
              <li
                key={s.node_id}
                title={s.error}
                className={`rounded px-2 py-0.5 font-mono text-[11px] ring-1 ${
                  s.status === "APPLIED"
                    ? "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30"
                    : s.status === "FAILED"
                      ? "bg-rose-500/10 text-rose-300 ring-rose-500/30"
                      : "bg-slate-500/10 text-slate-400 ring-slate-500/30"
                }`}
              >
                {s.tool_id} · {s.status.toLowerCase()}
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
