import type { ActionOut, GraphNode } from "../api/types";
import { agentName, agentStyle, humanParams, humanTool } from "../lib/format";

/** Step 1: Compact summary of what the agent proposed and whether it's authorized */
export function ProposedAction({ action, root }: { action: ActionOut; root: GraphNode }) {
  const style = agentStyle(root.agent_id);
  const auth = root.authorization;
  return (
    <section id="step-proposed" aria-label="Proposed action" className="scroll-mt-24 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Proposed Action</div>
          <h2 className="mt-1 flex flex-wrap items-baseline gap-x-2 text-lg font-semibold leading-tight">
            <span style={{ color: style.color }}>{agentName(root.agent_id)}</span>
            <span className="font-normal text-slate-500">→</span>
            <span className="text-slate-900">{humanTool(root.tool_id)}</span>
          </h2>
          <div className="mt-1 text-sm text-slate-600" title={JSON.stringify(root.params)}>
            {humanParams(root.params)}
          </div>
          {action.raw_text && <p className="mt-1 text-xs italic text-slate-500">"{action.raw_text}"</p>}
        </div>
        {auth && (
          <span
            data-testid="root-authorization"
            className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold ${
              auth.granted ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
            }`}
            title={auth.message}
          >
            {auth.granted ? "✓ Authorized" : `✗ ${auth.code ?? "Not authorized"}`}
          </span>
        )}
      </div>
    </section>
  );
}
