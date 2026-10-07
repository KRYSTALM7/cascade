import type { BlastRadius as Radius } from "../api/types";
import { agentStyle, inr } from "../lib/format";

function Stat({ label, value, hint, tone = "text-slate-100" }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone}`}>{value}</div>
      {hint && <div className="mt-0.5 truncate text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

export function BlastRadius({ radius }: { radius: Radius }) {
  const money = radius.money_out !== "0.00";
  return (
    <section aria-label="Blast radius" className="grid grid-cols-2 gap-3 md:grid-cols-5">
      <Stat
        label="Money out"
        value={inr(radius.money_out)}
        hint={money ? "leaves NovaCart" : "no money moves"}
        tone={money ? "text-amber-300" : "text-slate-100"}
      />
      <Stat
        label="Agents affected"
        value={String(radius.agent_count)}
        hint={radius.agents_affected.map((a) => agentStyle(a).label).join(" · ") || "none"}
      />
      <Stat label="Downstream actions" value={String(radius.downstream_actions)} hint={`${radius.record_count} records written`} />
      <Stat
        label="Reversibility"
        value={radius.reversibility}
        hint={`${radius.irreversible_nodes.length} irreversible step(s)`}
        tone={radius.reversibility === "FULL" ? "text-emerald-300" : radius.reversibility === "NONE" ? "text-rose-300" : "text-orange-300"}
      />
      <Stat
        label="Stopped"
        value={String(radius.blocked_nodes.length + radius.would_fail_nodes.length)}
        hint={`${radius.blocked_nodes.length} blocked · ${radius.would_fail_nodes.length} would fail`}
        tone={radius.blocked_nodes.length ? "text-rose-300" : "text-slate-100"}
      />
    </section>
  );
}
