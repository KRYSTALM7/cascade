import type { ConsequenceReport, GraphNode } from "../api/types";
import { nodeMoneyOut } from "../graph/layout";
import { agentName, agentStyle, humanEvent, humanTool, inr, toolTitle } from "../lib/format";

function paramText(params: Record<string, unknown>): string {
  return Object.entries(params)
    .map(([k, v]) => `${k}: ${k === "amount" && typeof v === "string" ? inr(v) : typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(" · ");
}

function Step({ label, children, tone = "text-slate-700" }: { label: string; children: React.ReactNode; tone?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`text-sm ${tone}`}>{children}</div>
    </div>
  );
}

function Outcome({ node }: { node: GraphNode }) {
  if (node.status === "WILL_EXECUTE") return <span title={node.summary}>{node.summary || "will execute"}</span>;
  if (node.status === "SKIPPED_LIMIT") return <span className="text-slate-500">not explored (cascade limit)</span>;
  return <span className="text-rose-700">{node.status === "BLOCKED" ? "blocked" : "would fail"} · {node.status_code}</span>;
}

function Verdict({ node }: { node: GraphNode }) {
  if (node.status === "WILL_EXECUTE") return <span className="font-semibold text-emerald-700">✓ Allowed</span>;
  if (node.status === "SKIPPED_LIMIT") return <span className="text-slate-500">Not explored (cascade limit)</span>;
  return (
    <span className="font-semibold text-rose-700" title={node.status_message ?? undefined}>
      ✗ {node.status === "BLOCKED" ? "Blocked" : "Would fail"}
    </span>
  );
}

/** The story version of the cascade: who reacted to what, what they proposed, and whether it may run.
 * Rule ids, versions, raw events and conditions live in the technical chain below. */
export function PlainChain({ report }: { report: ConsequenceReport }) {
  const byId = new Map(report.nodes.map((n) => [n.id, n]));
  const triggered = report.nodes.filter((n) => n.trigger_type === "AGENT_REACTION");
  if (triggered.length === 0) {
    return <p className="text-sm text-slate-600">No other agent reacts to this action. What you see is everything that happens.</p>;
  }
  return (
    <ol className="space-y-2" aria-label="What each agent does">
      {triggered.map((node) => {
        const style = agentStyle(node.agent_id);
        const parent = node.parent_id ? byId.get(node.parent_id) : undefined;
        const money = nodeMoneyOut(node);
        return (
          <li key={node.id} data-testid={`plain-${node.id}`} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span className="font-semibold" style={{ color: style.color }}>
                {agentName(node.agent_id)}
              </span>
              <span className="text-slate-500">
                saw “{humanEvent(node.trigger_event)}”{parent && parent.trigger_type !== "ROOT" ? ` (from ${agentName(parent.agent_id)})` : ""} and proposed
              </span>
              <span aria-hidden className="text-slate-400">→</span>
              <span className="text-slate-900">{toolTitle(node.tool_id)}</span>
              {money && <span className="font-mono text-amber-700">{inr(money)}</span>}
              <span aria-hidden className="text-slate-400">→</span>
              <Verdict node={node} />
              {!node.required && <span className="rounded px-1.5 py-0.5 text-[10px] text-slate-600 ring-1 ring-slate-300">optional</span>}
            </div>
            {node.trigger_reason && <div className="mt-0.5 text-xs text-slate-600">{node.trigger_reason}</div>}
          </li>
        );
      })}
    </ol>
  );
}

/** Technical view: no downstream step was requested by anyone. Each is a separate agent that reacted to
 * an event under a declared rule, proposed its own tool call, and was authorized on its own. */
export function CausalChain({ report }: { report: ConsequenceReport }) {
  const byId = new Map(report.nodes.map((n) => [n.id, n]));
  const triggered = report.nodes.filter((n) => n.trigger_type === "AGENT_REACTION");
  if (triggered.length === 0) {
    return (
      <section aria-label="Why it happens" className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">Reaction rules · why each step happens</div>
        No other agent reacts to this action.
      </section>
    );
  }
  return (
    <section aria-label="Why it happens" className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">Reaction rules · why each step happens</div>
      <p className="mt-1 text-sm text-slate-600">
        Nobody asked for these steps. Each is another agent reacting to an event, proposing its own tool call, and passing (or failing) its own
        authorization check. Nothing is inherited from the proposer.
      </p>
      <ol className="mt-3 space-y-2" aria-label="Agent-triggered consequences">
        {triggered.map((node) => {
          const parent = node.parent_id ? byId.get(node.parent_id) : undefined;
          const style = agentStyle(node.agent_id);
          const auth = node.authorization;
          return (
            <li
              key={node.id}
              data-testid={`chain-${node.id}`}
              className="flex flex-col md:flex-row md:flex-wrap md:items-start gap-x-3 gap-y-2 rounded-lg border border-slate-200 bg-white px-3 py-2"
            >
              <Step label="State change">
                {parent ? humanTool(parent.tool_id) : "?"} emits <span className="font-mono text-xs break-words">{node.trigger_event}</span>
              </Step>
              <span aria-hidden className="self-center text-slate-400 hidden md:block">
                →
              </span>
              <Step label="Reaction rule">
                <span className="font-mono text-xs break-words" title={node.trigger_reason ?? undefined}>
                  {node.rule_id}@{node.rule_version}
                </span>
                {node.trigger_condition && node.trigger_condition !== "ALWAYS" && <span className="text-xs text-slate-500 break-words"> if {node.trigger_condition}</span>}
              </Step>
              <span aria-hidden className="self-center text-slate-400 hidden md:block">
                →
              </span>
              <Step label="Agent triggered" tone="font-semibold">
                <span style={{ color: style.color }}>{style.label}</span>
                {!node.required && <span className="ml-1 text-xs font-normal text-slate-500">(optional)</span>}
              </Step>
              <span aria-hidden className="self-center text-slate-400 hidden md:block">
                →
              </span>
              <Step label="Proposes">
                <span className="break-words">{humanTool(node.tool_id)}</span> <span className="font-mono text-xs text-slate-600 break-words">{paramText(node.params)}</span>
              </Step>
              <span aria-hidden className="self-center text-slate-400 hidden md:block">
                →
              </span>
              <Step label="Own authorization" tone={auth?.granted ? "text-emerald-700" : auth ? "text-rose-700" : "text-slate-500"}>
                <span className="break-words" title={auth?.message}>{auth ? (auth.granted ? "✓ granted" : `✗ ${auth.code ?? "denied"}`) : "not checked"}</span>
              </Step>
              <span aria-hidden className="self-center text-slate-400 hidden md:block">
                →
              </span>
              <Step label="Simulated">
                <Outcome node={node} />
              </Step>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
