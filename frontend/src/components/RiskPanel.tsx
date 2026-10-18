import type { Decision, PolicyReason, RiskAssessment } from "../api/types";
import { DECISION_TEXT, LEVEL_TEXT, topReasons } from "../lib/format";

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
  BLOCK: "border-rose-200 bg-rose-50 text-rose-700",
  APPROVAL: "border-amber-200 bg-amber-50 text-amber-700",
  INFO: "border-slate-200 bg-slate-50 text-slate-600",
};

const BANNER: Record<Decision, { title: string; text: string; style: string }> = {
  APPROVAL_REQUIRED: {
    title: "APPROVAL REQUIRED",
    text: "Cascade paused this action. A human approver must decide before anything runs.",
    style: "border-amber-300 bg-amber-50 text-amber-900",
  },
  BLOCKED: {
    title: "BLOCKED",
    text: "Cascade will not run this action. Nobody can approve it.",
    style: "border-rose-300 bg-rose-50 text-rose-900",
  },
  AUTO_APPROVED: {
    title: "AUTO-APPROVED",
    text: "Within policy limits: this can run without a human.",
    style: "border-emerald-300 bg-emerald-50 text-emerald-900",
  },
};

/** Combined risk assessment and policy decision - no repetition */
export function RiskPanel({ risk, reasons, decision }: { risk: RiskAssessment; reasons: PolicyReason[]; decision: Decision }) {
  const banner = BANNER[decision];
  const topReasonsList = topReasons(reasons);

  return (
    <section id="step-decision" aria-label="Risk and decision" className="scroll-mt-24 space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-primary-600">Risk Assessment</div>
        <h3 className="mt-0.5 text-lg font-bold text-slate-900">Policy Decision</h3>
      </div>

      <div className="grid gap-5 md:grid-cols-[200px_1fr]">
        {/* Risk Score */}
        <div>
          <div className={`text-xl font-bold tracking-tight ${LEVEL_TEXT[risk.level]}`}>{risk.level} RISK</div>
          <div className="mt-1 flex items-baseline gap-1">
            <span data-testid="risk-score" className="text-4xl font-bold tabular-nums text-slate-900">
              {risk.score}
            </span>
            <span className="text-base text-slate-500">/ 100</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden>
            <div className={`h-full rounded-full ${barTone(risk.score)}`} style={{ width: `${Math.min(100, risk.score)}%` }} />
          </div>
          {risk.raw_score !== risk.score && <p className="mt-1 text-xs text-slate-500">Formula gives {risk.raw_score}; a policy floor raised it.</p>}
        </div>

        {/* Top Reasons */}
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Why</h4>
          <ul className="mt-2 space-y-2" aria-label="Top reasons">
            {topReasonsList.map((r, i) => (
              <li key={`${r.code}-${i}`} className={`rounded-lg border px-3 py-2 text-sm ${SEVERITY[r.severity]}`} title={r.code}>
                {r.message}
              </li>
            ))}
            {reasons.length === 0 && <li className="text-sm text-slate-500">No policy rule fired.</li>}
          </ul>
        </div>
      </div>

      {/* Decision Banner */}
      <div data-testid="decision-banner" className={`rounded-lg border-2 px-4 py-3 ${banner.style}`}>
        <div className={`text-xl font-bold tracking-wide ${DECISION_TEXT[decision]}`}>{banner.title}</div>
        <div className="mt-0.5 text-sm">{banner.text}</div>
      </div>
    </section>
  );
}

/** Technical details: weighted dimensions and full reason list (collapsed by default) */
export function RiskDetails({ risk, reasons }: { risk: RiskAssessment; reasons: PolicyReason[] }) {
  return (
    <section aria-label="Risk breakdown" className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Risk breakdown · weighted dimensions</h3>
      <ul className="mt-3 space-y-3">
        {risk.dimensions.map((d) => {
          const score = Number(d.score);
          return (
            <li key={d.key} data-testid={`dimension-${d.key}`}>
              <div className="flex justify-between text-sm">
                <span className="text-slate-700">
                  {d.label} <span className="text-xs text-slate-500">× {d.weight}</span>
                </span>
                <span className="font-mono tabular-nums text-slate-900">{d.score}</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100" role="meter" aria-label={d.label} aria-valuenow={score} aria-valuemin={0} aria-valuemax={100}>
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
