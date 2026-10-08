import { useMutation } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { api } from "../api/endpoints";
import type { Side, WhatIfResult } from "../api/types";
import { DECISION_RANK, DECISION_STYLE, DECISION_TEXT, LEVEL_TEXT, absAmount, inr, inrShort, toolTitle } from "../lib/format";
import type { WhatIfPreset } from "../lib/scenarios";
import { useUser } from "../lib/userContext";
import { ErrorBanner } from "./ErrorBanner";
import { ExplanationCard } from "./ExplanationCard";

const REVERSIBILITY: Record<Side["reversibility"], string> = { FULL: "Fully reversible", PARTIAL: "Partly irreversible", NONE: "Irreversible" };

function Row({ label, base, alt }: { label: string; base: ReactNode; alt: ReactNode }) {
  return (
    <tr className="border-t border-slate-800/80">
      <th scope="row" className="py-2 pr-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
        {label}
      </th>
      <td className="py-2 pr-3">{base}</td>
      <td className="py-2">{alt}</td>
    </tr>
  );
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Plain-language deltas from the backend's comparison. Wording only: every number is the backend's. */
function deltas(result: WhatIfResult): { text: string; good: boolean | null }[] {
  const { base, alternative: alt, delta } = result.comparison;
  const money = delta.money_out;
  const out: { text: string; good: boolean | null }[] = [];
  if (money.startsWith("-")) out.push({ text: `${inrShort(absAmount(money))} less exposure`, good: true });
  else if (money !== "0.00") out.push({ text: `${inrShort(money)} more exposure`, good: false });
  if (delta.downstream_actions < 0) out.push({ text: plural(-delta.downstream_actions, "fewer downstream action"), good: true });
  else if (delta.downstream_actions > 0) out.push({ text: plural(delta.downstream_actions, "more downstream action"), good: false });
  if (delta.agents < 0) out.push({ text: `${-delta.agents} fewer agent${delta.agents === -1 ? "" : "s"} involved`, good: true });
  else if (delta.agents > 0) out.push({ text: `${delta.agents} more agent${delta.agents === 1 ? "" : "s"} involved`, good: false });
  if (delta.risk_score < 0) out.push({ text: `Lower risk: ${base.risk_level} ${base.risk_score} → ${alt.risk_level} ${alt.risk_score}`, good: true });
  else if (delta.risk_score > 0) out.push({ text: `Higher risk: ${base.risk_level} ${base.risk_score} → ${alt.risk_level} ${alt.risk_score}`, good: false });
  if (alt.decision !== base.decision) {
    out.push({ text: `Decision: ${DECISION_STYLE[base.decision].label} → ${DECISION_STYLE[alt.decision].label}`, good: DECISION_RANK[alt.decision] < DECISION_RANK[base.decision] });
  }
  return out;
}

const REVERSIBILITY_RANK: Record<Side["reversibility"], number> = { FULL: 0, PARTIAL: 1, NONE: 2 };

interface Assessment {
  headline: string;
  recommended: boolean;
  tradeoffs: string[];
}

/** Honest verdict from the backend's comparison (wording only; no number is computed here).
 * "Recommended" requires: lower risk, the same action as requested (so the requested outcome is
 * kept), no stricter decision, not blocked, and no less reversible. Anything short of that is a
 * lower-risk alternative WITH trade-offs, stated plainly. */
function assess(result: WhatIfResult, baseToolId: string | null | undefined): Assessment {
  const { base, alternative: alt, lower_risk } = result.comparison;
  const altTool = result.alternative.action.tool_id;
  const sameAction = !!baseToolId && altTool === baseToolId;
  const lessReversible = REVERSIBILITY_RANK[alt.reversibility] > REVERSIBILITY_RANK[base.reversibility];
  const stricter = alt.decision === "BLOCKED" || DECISION_RANK[alt.decision] > DECISION_RANK[base.decision];
  const tradeoffs: string[] = [];
  if (!sameAction) {
    tradeoffs.push(
      altTool && baseToolId
        ? `Trade-off: a different action (${toolTitle(altTool)} instead of ${toolTitle(baseToolId).toLowerCase()}) — it does not preserve the originally requested outcome`
        : "Trade-off: may not preserve the originally requested outcome",
    );
  }
  if (lessReversible) tradeoffs.push(alt.reversibility === "NONE" ? "Irreversible: none of it can be undone" : "Less reversible than the proposal");
  if (alt.decision === "APPROVAL_REQUIRED") tradeoffs.push("Approval still required");
  if (alt.decision === "BLOCKED") tradeoffs.push("Blocked: it cannot run");
  const recommended = lower_risk && sameAction && !stricter && !lessReversible;
  const headline = recommended ? "Safer alternative" : lower_risk && alt.decision !== "BLOCKED" ? "Lower-risk alternative" : lower_risk ? "Lower risk, but not a better outcome" : "Not safer than the proposal";
  return { headline, recommended, tradeoffs };
}

const sideCell = {
  exposure: (s: Side) => <span className="font-mono text-amber-300">{inr(s.money_out)}</span>,
  risk: (s: Side) => (
    <span className={`font-semibold ${LEVEL_TEXT[s.risk_level]}`}>
      {s.risk_level} · {s.risk_score}/100
    </span>
  ),
  decision: (s: Side) => <span className={`font-semibold ${DECISION_TEXT[s.decision]}`}>{DECISION_STYLE[s.decision].label}</span>,
};

export function WhatIfPanel({ actionId, baseToolId, preset }: { actionId: string; baseToolId?: string | null; preset?: WhatIfPreset }) {
  const { userId } = useUser();
  const [text, setText] = useState("");
  const mutation = useMutation({ mutationFn: (q: string) => api.whatIf(userId, actionId, q) });
  const result: WhatIfResult | undefined = mutation.data;
  const verdict = result ? assess(result, baseToolId) : null;
  const good = !!verdict?.recommended;
  const lower = !!verdict && !good && result?.comparison.lower_risk && result.comparison.alternative.decision !== "BLOCKED";

  return (
    <section id="step-whatif" aria-label="What if" className="scroll-mt-24 space-y-4 rounded-2xl border border-indigo-500/40 bg-indigo-500/[0.05] p-5">
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.15em] text-indigo-300">What-if</div>
        <h3 className="text-xl font-semibold text-slate-100">Is there a safer option?</h3>
        <p className="text-sm text-slate-400">Cascade simulates an alternative the same way (same agent, same engines, same policy) and compares the two.</p>
      </div>

      {preset && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-400/30 bg-slate-950/60 px-4 py-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Suggested alternative</div>
            <div className="font-medium text-slate-100">{preset.label}</div>
            <div className="text-xs italic text-slate-500">“{preset.text}”</div>
          </div>
          <button
            type="button"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate(preset.text)}
            className="rounded-lg bg-indigo-500 px-5 py-2 font-semibold text-white hover:bg-indigo-400 disabled:opacity-50"
          >
            {mutation.isPending ? "Comparing…" : "Compare this alternative"}
          </button>
        </div>
      )}

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) mutation.mutate(text.trim());
        }}
      >
        <input
          aria-label="Alternative"
          value={text}
          placeholder={preset ? "…or describe your own alternative" : "Describe an alternative, e.g. “What if we give 10% compensation instead?”"}
          onChange={(e) => setText(e.target.value)}
          className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 placeholder:text-slate-600"
        />
        <button
          type="submit"
          disabled={mutation.isPending || !text.trim()}
          className="rounded-lg border border-indigo-400/60 px-4 py-2 text-sm font-semibold text-indigo-100 hover:bg-indigo-500/20 disabled:opacity-50"
        >
          Compare
        </button>
      </form>
      {mutation.error && <ErrorBanner error={mutation.error} />}

      {result && verdict && (
        <div className="space-y-4" data-testid="what-if-result">
          <div
            data-testid="what-if-verdict"
            className={`rounded-xl border px-4 py-3 ${good ? "border-emerald-500/50 bg-emerald-500/10" : lower ? "border-sky-500/40 bg-sky-500/[0.06]" : "border-slate-700 bg-slate-900/60"}`}
          >
            <div className={`text-lg font-bold ${good ? "text-emerald-300" : lower ? "text-sky-200" : "text-slate-200"}`}>{verdict.headline}</div>
            <div data-testid="what-if-summary" className="text-sm text-slate-300">
              {inrShort(result.comparison.alternative.money_out)} exposure · {plural(result.comparison.alternative.downstream_actions, "downstream action")} ·{" "}
              {result.comparison.alternative.risk_level} risk
            </div>
            <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label="Differences">
              {deltas(result).map((d) => (
                <li key={d.text} className={d.good === true ? "text-emerald-200" : d.good === false ? "text-rose-200" : "text-slate-300"}>
                  {d.good === true ? "▼ " : d.good === false ? "▲ " : "• "}
                  {d.text}
                </li>
              ))}
            </ul>
            {verdict.tradeoffs.length > 0 && (
              <ul data-testid="what-if-tradeoffs" className="mt-2 space-y-0.5 border-t border-slate-700/60 pt-2 text-sm text-amber-100" aria-label="Trade-offs">
                {verdict.tradeoffs.map((t) => (
                  <li key={t}>⚠ {t}</li>
                ))}
              </ul>
            )}
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/50 px-4 py-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left align-bottom">
                  <th className="py-2" />
                  <th className="py-2 pr-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Proposed action</div>
                    <div className="font-medium text-slate-100">{result.comparison.base.title}</div>
                  </th>
                  <th className="py-2">
                    <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Alternative
                      {good && (
                        <span data-testid="recommended" className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-emerald-200 ring-1 ring-emerald-400/50">
                          Recommended
                        </span>
                      )}
                    </div>
                    <div className="font-medium text-slate-100">{result.comparison.alternative.title}</div>
                  </th>
                </tr>
              </thead>
              <tbody>
                <Row label="Exposure" base={sideCell.exposure(result.comparison.base)} alt={sideCell.exposure(result.comparison.alternative)} />
                <Row label="Downstream actions" base={result.comparison.base.downstream_actions} alt={result.comparison.alternative.downstream_actions} />
                <Row label="Agents affected" base={result.comparison.base.agents.length} alt={result.comparison.alternative.agents.length} />
                <Row label="Risk" base={sideCell.risk(result.comparison.base)} alt={sideCell.risk(result.comparison.alternative)} />
                <Row label="Decision" base={sideCell.decision(result.comparison.base)} alt={sideCell.decision(result.comparison.alternative)} />
                <Row
                  label="Reversibility"
                  base={REVERSIBILITY[result.comparison.base.reversibility]}
                  alt={REVERSIBILITY[result.comparison.alternative.reversibility]}
                />
              </tbody>
            </table>
          </div>

          <ExplanationCard explanation={result.comparison.explanation} />
          <Link className="inline-block text-indigo-300 hover:underline" to={`/simulate?action=${result.alternative.action.id}`}>
            Open the alternative →
          </Link>
        </div>
      )}
    </section>
  );
}
