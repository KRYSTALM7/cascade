import { useMutation } from "@tanstack/react-query";
import { useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { api } from "../api/endpoints";
import type { Side, WhatIfResult } from "../api/types";
import { agentName, DECISION_RANK, DECISION_STYLE, absAmount, inr, inrShort, toolTitle } from "../lib/format";
import type { WhatIfPreset } from "../lib/scenarios";
import { useUser } from "../lib/userContext";
import { ErrorBanner } from "./ErrorBanner";
import { ExplanationCard } from "./ExplanationCard";

const REVERSIBILITY: Record<Side["reversibility"], string> = { FULL: "Fully reversible", PARTIAL: "Partly irreversible", NONE: "Irreversible" };

function Row({ label, base, alt }: { label: string; base: ReactNode; alt: ReactNode }) {
  return (
    <tr className="border-t border-slate-200">
      <th scope="row" className="py-2 pr-3 text-left text-xs font-medium uppercase tracking-wider text-slate-600">
        {label}
      </th>
      <td className="py-2 pr-3 font-medium text-slate-900">{base}</td>
      <td className="py-2 font-medium text-slate-900">{alt}</td>
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
const COMPARISON_LEVEL_TEXT: Record<Side["risk_level"], string> = {
  LOW: "text-emerald-700",
  MEDIUM: "text-amber-800",
  HIGH: "text-orange-800",
  CRITICAL: "text-rose-700",
};
const COMPARISON_DECISION_TEXT: Record<Side["decision"], string> = {
  AUTO_APPROVED: "text-emerald-700",
  APPROVAL_REQUIRED: "text-amber-800",
  BLOCKED: "text-rose-700",
};

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
  exposure: (s: Side) => <span className="font-mono text-amber-700">{inr(s.money_out)}</span>,
  agents: (s: Side) => (
    <span className="text-slate-900">
      <span className="font-semibold">{s.agents.length}</span>
      {s.agents.length > 0 && <span className="text-slate-700"> — {s.agents.map(agentName).join(", ")}</span>}
    </span>
  ),
  risk: (s: Side) => (
    <span className={`font-semibold ${COMPARISON_LEVEL_TEXT[s.risk_level]}`}>
      {s.risk_level} · {s.risk_score}/100
    </span>
  ),
  decision: (s: Side) => <span className={`font-semibold ${COMPARISON_DECISION_TEXT[s.decision]}`}>{DECISION_STYLE[s.decision].label}</span>,
};

export function WhatIfPanel({ actionId, baseToolId, preset }: { actionId: string; baseToolId?: string | null; preset?: WhatIfPreset }) {
  const { userId } = useUser();
  const [text, setText] = useState("");
  const compareLock = useRef(false);
  const mutation = useMutation({ mutationFn: (q: string) => api.whatIf(userId, actionId, q) });
  const result: WhatIfResult | undefined = mutation.data;
  const verdict = result ? assess(result, baseToolId) : null;
  const good = !!verdict?.recommended;
  const lower = !!verdict && !good && result?.comparison.lower_risk && result.comparison.alternative.decision !== "BLOCKED";
  const compare = (query: string) => {
    const alternative = query.trim();
    if (!alternative || compareLock.current) return;
    compareLock.current = true;
    mutation.reset();
    mutation.mutate(alternative, { onSettled: () => { compareLock.current = false; } });
  };

  return (
    <section id="step-whatif" aria-label="What if" aria-busy={mutation.isPending} className="scroll-mt-24 space-y-4 rounded-2xl border border-indigo-200 bg-indigo-50 p-5">
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.15em] text-indigo-700">What-if</div>
        <h3 className="text-xl font-semibold text-slate-900">Is there a safer option?</h3>
        <p className="text-sm text-slate-700">Cascade simulates an alternative the same way (same agent, same engines, same policy) and compares the two.</p>
      </div>

      {preset && (
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 rounded-xl border border-indigo-200 bg-white px-4 py-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">Suggested alternative</div>
            <div className="font-medium text-slate-900">{preset.label}</div>
            <div className="text-xs italic text-slate-500">“{preset.text}”</div>
          </div>
          <button
            type="button"
            disabled={mutation.isPending}
            onClick={() => compare(preset.text)}
            className="w-full md:w-auto min-h-[44px] rounded-lg bg-indigo-600 px-5 py-2 font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-700"
          >
            {mutation.isPending ? "Comparing…" : "Compare this alternative"}
          </button>
        </div>
      )}

      <form
        className="flex flex-col md:flex-row gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          compare(text);
        }}
      >
        <input
          aria-label="Alternative"
          value={text}
          disabled={mutation.isPending}
          placeholder={preset ? "…or describe your own alternative" : "Describe an alternative, e.g. “What if we give 10% compensation instead?”"}
          onChange={(e) => setText(e.target.value)}
          className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 min-h-[44px] text-slate-900 placeholder:text-slate-500 disabled:cursor-wait disabled:bg-slate-100"
          style={{ fontSize: '16px' }}
        />
        <button
          type="submit"
          disabled={mutation.isPending || !text.trim()}
          className="w-full md:w-auto min-h-[44px] rounded-lg border border-indigo-300 px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:border-slate-300 disabled:bg-slate-100 disabled:text-slate-600"
        >
          Compare
        </button>
      </form>
      {mutation.isPending && <p role="status" className="text-sm font-medium text-indigo-800">Comparing this alternative…</p>}
      {mutation.error && <ErrorBanner error={mutation.error} />}

      {result && verdict && (
        <div className="space-y-4" data-testid="what-if-result">
          <p data-testid="what-if-compared-text" className="break-words text-sm text-slate-700">
            Comparison for: <span className="font-medium text-slate-900">{mutation.variables}</span>
          </p>
          <div
            data-testid="what-if-verdict"
            className={`rounded-xl border px-4 py-3 ${good ? "border-emerald-300 bg-emerald-50" : lower ? "border-sky-300 bg-sky-50" : "border-slate-200 bg-white"}`}
          >
            <div className={`text-lg font-bold ${good ? "text-emerald-700" : lower ? "text-sky-700" : "text-slate-900"}`}>{verdict.headline}</div>
            <div data-testid="what-if-summary" className="text-sm text-slate-700">
              {inrShort(result.comparison.alternative.money_out)} exposure · {plural(result.comparison.alternative.downstream_actions, "downstream action")} ·{" "}
              {result.comparison.alternative.risk_level} risk
            </div>
            <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label="Differences">
              {deltas(result).map((d) => (
                <li key={d.text} className={d.good === true ? "text-emerald-700" : d.good === false ? "text-rose-700" : "text-slate-700"}>
                  {d.good === true ? "▼ " : d.good === false ? "▲ " : "• "}
                  {d.text}
                </li>
              ))}
            </ul>
            {verdict.tradeoffs.length > 0 && (
              <ul data-testid="what-if-tradeoffs" className="mt-2 space-y-0.5 border-t border-slate-200 pt-2 text-sm text-amber-800" aria-label="Trade-offs">
                {verdict.tradeoffs.map((t) => (
                  <li key={t}>⚠ {t}</li>
                ))}
              </ul>
            )}
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white px-4 py-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left align-bottom">
                  <th className="py-2" />
                  <th className="py-2 pr-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">Proposed action</div>
                    <div className="font-medium text-slate-900">{result.comparison.base.title}</div>
                  </th>
                  <th className="py-2">
                    <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-600">
                      Alternative
                      {good && (
                        <span data-testid="recommended" className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-800 ring-1 ring-emerald-300">
                          Recommended
                        </span>
                      )}
                    </div>
                    <div className="font-medium text-slate-900">{result.comparison.alternative.title}</div>
                  </th>
                </tr>
              </thead>
              <tbody>
                <Row label="Exposure" base={sideCell.exposure(result.comparison.base)} alt={sideCell.exposure(result.comparison.alternative)} />
                <Row label="Downstream actions" base={result.comparison.base.downstream_actions} alt={result.comparison.alternative.downstream_actions} />
                <Row label="Agents affected" base={sideCell.agents(result.comparison.base)} alt={sideCell.agents(result.comparison.alternative)} />
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
          <Link className="inline-block font-medium text-indigo-700 hover:text-indigo-900 hover:underline" to={`/simulate?action=${result.alternative.action.id}`}>
            Open the alternative →
          </Link>
        </div>
      )}
    </section>
  );
}
