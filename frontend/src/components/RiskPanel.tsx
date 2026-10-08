import type { Decision, PolicyReason, RiskAssessment } from "../api/types";
import { DECISION_TEXT, LEVEL_TEXT, topReasons } from "../lib/format";
import { RiskBadge } from "./Badges";

const BAR: Record<string, string> = {
  LOW: "bg-emerald-400",
  MEDIUM: "bg-amber-400",
  HIGH: "bg-orange-500",
  CRITICAL: "bg-rose-500",
};

function barTone(score: number): string {
  if (score >= 80) return BAR.CRITICAL ?? "";
  if (score >= 60) return BAR.HIGH ?? "";
  if (score >= 35) return BAR.MEDIUM ?? "";
  return BAR.LOW ?? "";
}

const SEVERITY: Record<PolicyReason["severity"], string> = {
  BLOCK: "border-rose-500/50 bg-rose-500/10 text-rose-200",
  APPROVAL: "border-amber-500/50 bg-amber-500/10 text-amber-100",
  INFO: "border-slate-700 bg-slate-800/40 text-slate-300",
};

const BANNER: Record<Decision, { title: string; text: string; style: string }> = {
  APPROVAL_REQUIRED: {
    title: "APPROVAL REQUIRED",
    text: "Cascade paused this action. A human approver must decide before anything runs.",
    style: "border-amber-400/60 bg-amber-500/15 text-amber-200",
  },
  BLOCKED: {
    title: "BLOCKED",
    text: "Cascade will not run this action. Nobody can approve it.",
    style: "border-rose-500/60 bg-rose-500/15 text-rose-200",
  },
  AUTO_APPROVED: {
    title: "AUTO-APPROVED",
    text: "Within policy limits: this can run without a human.",
    style: "border-emerald-500/50 bg-emerald-500/10 text-emerald-200",
  },
};

/** Risk & policy decision: the conclusion first, the arithmetic in Technical details. */
export function RiskPanel({ risk, reasons, decision }: { risk: RiskAssessment; reasons: PolicyReason[]; decision: Decision }) {
  const banner = BANNER[decision];
  return (
    <section id="step-decision" aria-label="Risk and decision" className="scroll-mt-24 space-y-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <div className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-400">Risk &amp; policy decision</div>
      <div className="grid gap-5 md:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
        <div>
          <div className={`text-3xl font-bold tracking-tight ${LEVEL_TEXT[risk.level]}`}>{risk.level} RISK</div>
          <div className="mt-1 flex items-baseline gap-1">
            <span data-testid="risk-score" className="text-5xl font-bold tabular-nums text-white">
              {risk.score}
            </span>
            <span className="text-lg text-slate-500">/ 100</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800" aria-hidden>
            <div className={`h-full rounded-full ${barTone(risk.score)}`} style={{ width: `${Math.min(100, risk.score)}%` }} />
          </div>
          {risk.raw_score !== risk.score && <p className="mt-1 text-xs text-slate-500">Formula gives {risk.raw_score}; a policy floor raised it.</p>}
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Why</h4>
          <ul className="mt-2 space-y-2" aria-label="Top reasons">
            {topReasons(reasons).map((r, i) => (
              <li key={`${r.code}-${i}`} className={`rounded-lg border px-3 py-2 text-sm ${SEVERITY[r.severity]}`} title={r.code}>
                {r.message}
              </li>
            ))}
            {reasons.length === 0 && <li className="text-sm text-slate-400">No policy rule fired.</li>}
          </ul>
        </div>
      </div>
      <div data-testid="decision-banner" className={`rounded-xl border-2 px-5 py-4 ${banner.style}`}>
        <div className={`text-2xl font-extrabold tracking-wide ${DECISION_TEXT[decision]}`}>{banner.title}</div>
        <div className="mt-0.5 text-sm opacity-90">{banner.text}</div>
      </div>
    </section>
  );
}

/** Technical details: the five weighted dimensions and every reason with its stable code. */
export function RiskDetails({ risk, reasons }: { risk: RiskAssessment; reasons: PolicyReason[] }) {
  return (
    <section aria-label="Risk breakdown" className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Risk breakdown · weighted dimensions</h3>
        <RiskBadge level={risk.level} score={risk.score} />
      </div>
      <ul className="mt-4 space-y-3">
        {risk.dimensions.map((d) => {
          const score = Number(d.score);
          return (
            <li key={d.key} data-testid={`dimension-${d.key}`}>
              <div className="flex justify-between text-sm">
                <span className="text-slate-300">
                  {d.label} <span className="text-xs text-slate-500">× {d.weight}</span>
                </span>
                <span className="font-mono tabular-nums text-slate-300">{d.score}</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-800" role="meter" aria-label={d.label} aria-valuenow={score} aria-valuemin={0} aria-valuemax={100}>
                <div className={`h-full rounded-full ${barTone(score)}`} style={{ width: `${Math.min(100, score)}%` }} />
              </div>
              <div className="mt-0.5 text-xs text-slate-500">{d.explanation}</div>
            </li>
          );
        })}
      </ul>
      <h4 className="mt-5 text-xs font-semibold uppercase tracking-wider text-slate-500">All decision reasons</h4>
      <ul className="mt-2 space-y-2" aria-label="Decision reasons">
        {reasons.map((r, i) => (
          <li key={`${r.code}-${i}`} className={`rounded-lg border px-3 py-2 text-sm ${SEVERITY[r.severity]}`}>
            {r.message}
            <span className="ml-2 font-mono text-[10px] opacity-60">{r.code}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-slate-500">
        Policy {risk.policy_version}
        {risk.policy_fingerprint && <span className="ml-1 font-mono">· {risk.policy_fingerprint.slice(0, 12)}</span>}
      </p>
    </section>
  );
}
