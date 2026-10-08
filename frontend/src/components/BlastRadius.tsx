import type { BlastRadius as Radius, Decision, Explanation, RiskAssessment, RiskLevel } from "../api/types";
import { DECISION_RANK, DECISION_STYLE, DECISION_TEXT, LEVEL_TEXT, agentName, agentStyle, inr, inrShort } from "../lib/format";

function Stat({ label, value, hint, tone = "text-slate-100" }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${tone}`}>{value}</div>
      {hint && <div className="mt-0.5 truncate text-xs text-slate-500" title={hint}>{hint}</div>}
    </div>
  );
}

/** One headline number. The DOM reads "label value" (screen readers, tests); the eye sees the value first. */
function Headline({ label, value, tone = "text-white", testId, small }: { label: string; value: string; tone?: string; testId?: string; small?: boolean }) {
  return (
    <div data-testid={testId} className="flex min-w-0 flex-col-reverse justify-start px-4 py-3 sm:px-5">
      <div className="text-xs font-medium uppercase tracking-wider text-slate-400">{label}</div>
      <div className={`font-bold tabular-nums tracking-tight ${small ? "text-2xl leading-tight sm:text-[1.7rem]" : "text-3xl sm:text-4xl"} ${tone}`}>{value}</div>
    </div>
  );
}

const LEVEL_TONE: Record<string, string> = {
  NONE: "text-slate-100",
  INTERNAL: "text-slate-100",
  LOW: "text-slate-100",
  MEDIUM: "text-amber-300",
  PII: "text-amber-300",
  HIGH: "text-orange-300",
  BULK_PII: "text-rose-300",
  SEVERE: "text-rose-300",
};

const FRAME: Record<Decision, string> = {
  AUTO_APPROVED: "border-emerald-500/40 from-emerald-500/10",
  APPROVAL_REQUIRED: "border-amber-500/50 from-amber-500/10",
  BLOCKED: "border-rose-500/50 from-rose-500/10",
};

const REVERSIBILITY: Record<Radius["reversibility"], string> = {
  FULL: "Fully reversible",
  PARTIAL: "Partly irreversible",
  NONE: "Irreversible",
};

const human = (s: string) => s.replace(/_/g, " ");

function Verdict({ level, score, decision, money, testId }: { level: RiskLevel; score: number; decision: Decision; money: string; testId?: string }) {
  return (
    <div data-testid={testId} className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-lg font-semibold">
      <span className={LEVEL_TEXT[level]}>{level}</span>
      <span className="text-slate-600">·</span>
      <span className="tabular-nums text-slate-200">{score}/100</span>
      <span className="text-slate-600">·</span>
      <span className={DECISION_TEXT[decision]}>{DECISION_STYLE[decision].label}</span>
      <span className="text-slate-600">·</span>
      <span className="tabular-nums text-slate-200">{inrShort(money)}</span>
    </div>
  );
}

/** The action alone (what a permission check sees) vs the whole cascade (what Cascade sees). Same engines. */
function Contrast({ radius, direct, alone, risk, decision }: { radius: Radius; direct: Radius; alone: NonNullable<RiskAssessment["direct"]>; risk: RiskAssessment; decision: Decision }) {
  const looksSafe = alone.decision === "AUTO_APPROVED";
  return (
    <div data-testid="blast-contrast" className="grid gap-3 md:grid-cols-2">
      <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">{looksSafe ? "On its own: looks safe" : "On its own"}</div>
        <Verdict level={alone.level} score={alone.score} decision={alone.decision} money={direct.money_out} testId="contrast-alone" />
        <div className="mt-1 text-sm text-slate-500">
          {inr(direct.money_out)} out · {direct.record_count} record(s) · no other agent involved. This is all a permission check sees.
        </div>
      </div>
      <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-amber-300">With what happens next</div>
        <Verdict level={risk.level} score={risk.score} decision={decision} money={radius.money_out} testId="contrast-cascade" />
        <div className="mt-1 text-sm text-slate-300">
          {inr(radius.money_out)} out · {radius.record_count} records · {radius.agent_count} other agent(s), {radius.downstream_actions} downstream action(s)
        </div>
      </div>
    </div>
  );
}

/** The headline output: everything else that happens if this action runs. Every value is the backend's
 * (exact decimal strings, enums, counts); nothing is computed here. */
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
  const systems = radius.systems_affected ?? [];
  const alone = risk?.direct;
  // The cascade made a safe-looking action stricter: that gap is the whole point of Cascade.
  const hidden = !!(alone && decision && DECISION_RANK[decision] > DECISION_RANK[alone.decision]);

  return (
    <section
      id="step-blast"
      aria-label="Blast radius"
      className={`scroll-mt-24 space-y-4 rounded-2xl border-2 bg-gradient-to-b to-slate-950/40 p-5 ${decision ? FRAME[decision] : "border-slate-700 from-slate-900/40"}`}
    >
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-400">Blast radius</div>
        <h3 className="text-xl font-semibold text-slate-100">What else happens if this runs</h3>
      </div>

      <div data-testid="blast-headline" className="grid grid-cols-2 divide-slate-800 overflow-hidden rounded-xl border border-slate-800 bg-slate-950/70 sm:grid-cols-3 lg:grid-cols-5 lg:divide-x">
        <Headline label="Agents affected" value={String(radius.agent_count)} />
        <Headline label="Downstream actions" value={String(radius.downstream_actions)} />
        <Headline label="Exposure" value={inrShort(radius.money_out)} tone={money ? "text-amber-300" : "text-white"} />
        {risk && <Headline label="Risk" value={`${risk.level} · ${risk.score}`} tone={LEVEL_TEXT[risk.level]} testId="headline-risk" />}
        {decision && <Headline label="Decision" value={DECISION_STYLE[decision].label} tone={DECISION_TEXT[decision]} testId="headline-decision" small />}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        {radius.agents_affected.map((a) => (
          <span key={a} className="rounded-full bg-slate-900 px-2.5 py-0.5 text-xs font-medium ring-1 ring-slate-700" style={{ color: agentStyle(a).color }}>
            {agentName(a)}
          </span>
        ))}
        <span className={radius.reversibility === "FULL" ? "text-emerald-300" : radius.reversibility === "NONE" ? "text-rose-300" : "text-orange-300"}>
          {REVERSIBILITY[radius.reversibility]}
          {radius.irreversible_nodes.length > 0 && ` · ${radius.irreversible_nodes.length} step(s) cannot be undone`}
        </span>
      </div>

      {hidden && (
        <p data-testid="key-message" className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-base font-medium text-amber-100">
          The dangerous part isn&apos;t the action we authorized. It&apos;s what other agents do after it.
        </p>
      )}

      {explanation && (
        <section aria-label="Explanation" className="text-slate-200">
          <span className="mr-2 text-xs font-semibold uppercase tracking-wider text-indigo-300">In plain words</span>
          {explanation.summary}
        </section>
      )}

      {direct && alone && decision && risk && <Contrast radius={radius} direct={direct} alone={alone} risk={risk} decision={decision} />}

      <details className="group rounded-xl border border-slate-800 bg-slate-950/40">
        <summary className="cursor-pointer list-none px-4 py-2 text-xs text-slate-400 hover:text-slate-200">
          <span className="mr-2 inline-block transition group-open:rotate-90">▸</span>More impact details · money, records, customer, data, reversibility
        </summary>
        <div className="grid grid-cols-2 gap-3 border-t border-slate-800 p-3 md:grid-cols-3">
          <Stat label="Money out" value={inr(radius.money_out)} hint={money ? "leaves NovaCart" : "no money moves"} tone={money ? "text-amber-300" : "text-slate-100"} />
          <Stat
            label="Records · systems"
            value={`${radius.record_count} · ${systems.length || "—"}`}
            hint={systems.map(human).join(", ") || `${radius.record_count} records written`}
          />
          <Stat label="Customer impact" value={radius.customer_impact} tone={LEVEL_TONE[radius.customer_impact]} />
          <Stat label="Data sensitivity" value={human(radius.data_sensitivity)} tone={LEVEL_TONE[radius.data_sensitivity]} />
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
        </div>
      </details>
    </section>
  );
}
