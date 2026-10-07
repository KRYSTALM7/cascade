import { useQuery } from "@tanstack/react-query";
import { api } from "../api/endpoints";
import { ErrorBanner } from "../components/ErrorBanner";
import { agentStyle, humanTool } from "../lib/format";

export function AgentsPage() {
  const agents = useQuery({ queryKey: ["agents"], queryFn: api.agents });
  const reactions = useQuery({ queryKey: ["reactions"], queryFn: api.reactions });

  return (
    <div className="space-y-6">
      {(agents.error || reactions.error) && <ErrorBanner error={agents.error ?? reactions.error} />}
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {(agents.data ?? []).map((a) => (
          <article key={a.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4" style={{ borderTop: `3px solid ${agentStyle(a.id).color}` }}>
            <h3 className="font-semibold" style={{ color: agentStyle(a.id).color }}>
              {a.name}
            </h3>
            <p className="mt-1 text-xs text-slate-500">{a.description}</p>
            <div className="mt-3 text-[11px] uppercase tracking-wider text-slate-500">May call</div>
            <ul className="mt-1 flex flex-wrap gap-1">
              {a.permitted_tools.map((t) => (
                <li key={t} className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[11px] text-slate-300">
                  {t}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>
      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Declared reaction rules</h2>
        <p className="mt-1 text-xs text-slate-500">When an event is emitted and the condition holds, the agent calls the tool. This is what the consequence engine walks.</p>
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500">
              <th className="py-2 font-medium">When</th>
              <th className="py-2 font-medium">If</th>
              <th className="py-2 font-medium">Agent</th>
              <th className="py-2 font-medium">Calls</th>
              <th className="py-2 font-medium">Required</th>
              <th className="py-2 font-medium">Rule</th>
            </tr>
          </thead>
          <tbody>
            {(reactions.data ?? []).map((r) => (
              <tr key={r.id} className={`border-t border-slate-800/80 ${r.enabled ? "" : "opacity-40"}`} title={r.description}>
                <td className="py-2 font-mono text-xs text-slate-300">{r.event_type}</td>
                <td className="py-2 font-mono text-xs text-slate-400">
                  {r.condition_key}
                  {Object.keys(r.condition_params).length > 0 && ` ${JSON.stringify(r.condition_params)}`}
                </td>
                <td className="py-2" style={{ color: agentStyle(r.agent_id).color }}>
                  {r.agent_id}
                </td>
                <td className="py-2">{humanTool(r.tool_id)}</td>
                <td className="py-2">{r.required ? "required" : <span className="text-slate-500">optional</span>}</td>
                <td className="py-2 font-mono text-xs text-slate-500">
                  {r.id}@{r.version} · p{r.priority}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
