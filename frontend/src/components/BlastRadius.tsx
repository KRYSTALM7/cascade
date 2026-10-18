import type { BlastRadius as Radius, Decision, Explanation, RiskAssessment } from "../api/types";
import { DECISION_RANK, DECISION_STYLE, DECISION_TEXT, LEVEL_TEXT, agentName, agentStyle, inr, inrShort } from "../lib/format";

/** Compact metric display */
function Metric({ label, value, tone = "text-slate-900" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="text-center">
      <div className={`text-2xl font-bold tabular-nums ${tone}`}>{value}</div>
      <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500">{label}</div>
    </div>
  );
}

const REVERSIBILITY: Record<Radius["reversibility"], string> = {
  FULL: "Fully reversible",
  PARTIAL: "Partly irreversible",
  NONE: "Irreversible",
};

/** Clean, compact blast radius summary - the primary result */
export function BlastRadius({
  radius,
  direct,
  risk,
  decision,
  explanation,
}: {
  radius: Radius;
  direct?: Radius | null;
  risk?: RiskAssessment;
  decision?: Decision;
  explanation?: Explanation | null;
}) {
  const money = radius.money_out !== "0.00";
  const alone = risk?.direct;
  const hidden = !!(alone && decision && DECISION_RANK[decision] > DECISION_RANK[alone.decision]);

  return (
    <section
      id="step-blast"
      aria-label="Blast radius"
      className="scroll-mt-24 space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-primary-600">Blast Radius</div>
        <h3 className="mt-0.5 text-lg font-bold text-slate-900">What else happens if this runs</h3>
      </div>

      {/* Primary Metrics Grid */}
      <div data-testid="blast-headline" className="grid grid-cols-2 gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:grid-cols-5">
        <Metric label="Agents" value={String(radius.agent_count)} />
        <Metric label="Actions" value={String(radius.downstream_actions)} />
        <Metric label="Exposure" value={inrShort(radius.money_out)} tone={money ? "text-amber-600" : "text-slate-900"} />
        {risk && <Metric label="Risk" value={`${risk.level} · ${risk.score}`} tone={LEVEL_TEXT[risk.level]} />}
        {decision && <Metric label="Decision" value={DECISION_STYLE[decision].label.toUpperCase()} tone={DECISION_TEXT[decision]} />}
      </div>

      {/* Affected Agents & Reversibility */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {radius.agents_affected.map((a) => (
          <span key={a} className="rounded-lg border border-slate-200 bg-white px-2 py-0.5 text-xs font-medium" style={{ color: agentStyle(a).color }}>
            {agentName(a)}
          </span>
        ))}
        <span className={`text-xs ${radius.reversibility === "FULL" ? "text-emerald-600" : radius.reversibility === "NONE" ? "text-rose-600" : "text-orange-600"}`}>
          {REVERSIBILITY[radius.reversibility]}
          {radius.irreversible_nodes.length > 0 && ` · ${radius.irreversible_nodes.length} step(s) cannot be undone`}
        </span>
      </div>

      {/* Hidden Cascade Comparison */}
      {hidden && alone && direct && (
        <div data-testid="blast-contrast" className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="text-sm font-semibold text-amber-900">On its own: looks safe</div>
          <div data-testid="contrast-alone" className="rounded-lg border border-amber-300/50 bg-white px-3 py-2 text-sm font-medium text-slate-700">
            <div>{alone.level}·{alone.score}/100·{DECISION_STYLE[alone.decision].label}·{inrShort(direct.money_out)}</div>
            <div className="text-xs text-slate-600">{inr(direct.money_out)} out</div>
          </div>
          <div className="text-sm font-semibold text-amber-900">With what happens next</div>
          <div data-testid="contrast-cascade" className="rounded-lg border border-amber-300/50 bg-white px-3 py-2 text-sm font-medium text-slate-700">
            <div>{risk.level}·{risk.score}/100·{DECISION_STYLE[decision!].label}·{inrShort(radius.money_out)}</div>
            <div className="text-xs text-slate-600">{inr(radius.money_out)} out</div>
          </div>
        </div>
      )}

      {/* Key Message for Hidden Cascades */}
      {hidden && (
        <div data-testid="key-message" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
          ⚠️ The dangerous part isn't the action we authorized. It's what other agents do after it.
        </div>
      )}

      {/* Plain English Summary */}
      {explanation && (
        <div role="region" aria-label="Explanation" className="text-sm text-slate-700">
          <span className="mr-2 text-xs font-semibold uppercase tracking-wider text-slate-500">In plain words</span>
          {explanation.summary}
        </div>
      )}

      {/* Detailed Impact (Collapsible) */}
      <details className="group rounded-lg border border-slate-200 bg-slate-50">
        <summary className="cursor-pointer list-none px-4 py-2.5 text-xs font-medium text-slate-600 hover:text-slate-900">
          <span className="mr-2 inline-block transition group-open:rotate-90">▸</span>
          More impact details · money, records, systems, customer, data, reversibility
        </summary>
        <div className="grid grid-cols-2 gap-3 border-t border-slate-200 bg-white p-3 text-sm md:grid-cols-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Money out</div>
            <div className={`mt-0.5 font-semibold tabular-nums ${money ? "text-amber-600" : "text-slate-900"}`}>{inr(radius.money_out)}</div>
            <div className="text-xs text-slate-500">{money ? "leaves NovaCart" : "no money moves"}</div>
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Records</div>
            <div className="mt-0.5 font-semibold tabular-nums text-slate-900">{radius.record_count}</div>
            <div className="text-xs text-slate-500">affected</div>
          </div>
          {radius.systems_affected && radius.systems_affected.length > 0 && (
            <div className="col-span-2 md:col-span-1">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Systems</div>
              <div className="mt-0.5 text-xs text-slate-700">{radius.systems_affected.map(s => s.replace(/_/g, " ")).join(", ")}</div>
            </div>
          )}
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Customer impact</div>
            <div className="mt-0.5 font-semibold text-slate-900">{radius.customer_impact}</div>
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Data sensitivity</div>
            <div className="mt-0.5 font-semibold text-slate-900">{radius.data_sensitivity.replace(/_/g, " ")}</div>
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Reversibility</div>
            <div className={`mt-0.5 font-semibold ${radius.reversibility === "FULL" ? "text-emerald-600" : radius.reversibility === "NONE" ? "text-rose-600" : "text-orange-600"}`}>
              {radius.reversibility}
            </div>
            <div className="text-xs text-slate-500">{radius.irreversible_nodes.length} irreversible step(s)</div>
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Stopped</div>
            <div className="mt-0.5 font-semibold text-slate-900">{radius.blocked_nodes.length + radius.would_fail_nodes.length}</div>
            <div className="text-xs text-slate-500">{radius.blocked_nodes.length} blocked · {radius.would_fail_nodes.length} would fail</div>
          </div>
        </div>
      </details>
    </section>
  );
}
