import type { ActionOut, GraphNode } from "../api/types";
import { agentName, agentStyle, humanParams, humanTool } from "../lib/format";

/** Step 1 of the story: what the agent asked to do, and whether IT may do it. */
export function ProposedAction({ action, root }: { action: ActionOut; root: GraphNode }) {
  const style = agentStyle(root.agent_id);
  const auth = root.authorization;
  return (
    <section id="step-proposed" aria-label="Proposed action" className="scroll-mt-24 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Proposed action</div>
      <h2 className="mt-1 flex flex-wrap items-baseline gap-x-2 text-xl font-semibold">
        <span style={{ color: style.color }}>{agentName(root.agent_id)}</span>
        <span className="font-normal text-slate-500">wants to</span>
        <span className="text-slate-100">{humanTool(root.tool_id)}</span>
      </h2>
      <div className="mt-1 text-sm text-slate-400" title={JSON.stringify(root.params)}>
        {humanParams(root.params)}
      </div>
      {action.raw_text && <p className="mt-1 text-sm italic text-slate-500">“{action.raw_text}”</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        {auth && (
          <span
            data-testid="root-authorization"
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${
              auth.granted ? "bg-emerald-500/10 text-emerald-300 ring-emerald-500/40" : "bg-rose-500/15 text-rose-300 ring-rose-500/40"
            }`}
            title={auth.message}
          >
            {auth.granted ? "✓ Authorized" : `✗ ${auth.code ?? "Not authorized"}`}
          </span>
        )}
        <span className="text-slate-400">
          {auth
            ? auth.granted
              ? `The ${agentName(root.agent_id)} has permission to do this.`
              : auth.message
            : root.summary || root.status_message}
        </span>
      </div>
    </section>
  );
}
