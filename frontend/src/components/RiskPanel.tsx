import type { PolicyReason, RiskAssessment } from "../api/types";
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

export function RiskPanel({ risk, reasons }: { risk: RiskAssessment; reasons: PolicyReason[] }) {
  return (
    <section aria-label="Risk" className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Risk</h3>
        <div className="flex items-center gap-2">
          <span data-testid="risk-score" className="text-3xl font-semibold tabular-nums">
            {risk.score}
          </span>
          <span className="text-slate-500">/100</span>
          <RiskBadge level={risk.level} />
        </div>
      </div>
      {risk.raw_score !== risk.score && (
        <p className="mt-1 text-xs text-slate-500">Formula gives {risk.raw_score}; a policy floor raised it.</p>
      )}
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
      <h4 className="mt-5 text-xs font-semibold uppercase tracking-wider text-slate-500">Why</h4>
      <ul className="mt-2 space-y-2" aria-label="Decision reasons">
        {reasons.map((r, i) => (
          <li key={`${r.code}-${i}`} className={`rounded-lg border px-3 py-2 text-sm ${SEVERITY[r.severity]}`}>
            {r.message}
            <span className="ml-2 font-mono text-[10px] opacity-60">{r.code}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
