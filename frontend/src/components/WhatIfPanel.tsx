import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { api } from "../api/endpoints";
import type { Side, WhatIfResult } from "../api/types";
import { inr } from "../lib/format";
import { useUser } from "../lib/userContext";
import { DecisionBadge, RiskBadge } from "./Badges";
import { ErrorBanner } from "./ErrorBanner";
import { ExplanationCard } from "./ExplanationCard";

function SideCard({ title, side, highlight }: { title: string; side: Side; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${highlight ? "border-emerald-500/40 bg-emerald-500/5" : "border-slate-800 bg-slate-900/60"}`}>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{title}</div>
      <div className="mt-1 font-medium text-slate-100">{side.title}</div>
      <dl className="mt-3 grid grid-cols-2 gap-y-1.5 text-sm">
        <dt className="text-slate-500">Money out</dt>
        <dd className="text-right font-mono text-amber-300">{inr(side.money_out)}</dd>
        <dt className="text-slate-500">Other agents</dt>
        <dd className="text-right">{side.agents.length}</dd>
        <dt className="text-slate-500">Downstream actions</dt>
        <dd className="text-right">{side.downstream_actions}</dd>
        <dt className="text-slate-500">Reversibility</dt>
        <dd className="text-right">{side.reversibility}</dd>
        <dt className="text-slate-500">Risk</dt>
        <dd className="text-right">
          <RiskBadge level={side.risk_level} score={side.risk_score} />
        </dd>
        <dt className="text-slate-500">Decision</dt>
        <dd className="text-right">
          <DecisionBadge decision={side.decision} />
        </dd>
      </dl>
    </div>
  );
}

export function WhatIfPanel({ actionId }: { actionId: string }) {
  const { userId } = useUser();
  const [text, setText] = useState("What if we give 20% compensation instead?");
  const mutation = useMutation({ mutationFn: (q: string) => api.whatIf(userId, actionId, q) });
  const result: WhatIfResult | undefined = mutation.data;

  return (
    <section aria-label="What if" className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">What if…</h3>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) mutation.mutate(text.trim());
        }}
      >
        <input
          aria-label="Alternative"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100"
        />
        <button type="submit" disabled={mutation.isPending} className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-400 disabled:opacity-50">
          Compare
        </button>
      </form>
      {mutation.error && (
        <div className="mt-3">
          <ErrorBanner error={mutation.error} />
        </div>
      )}
      {result && (
        <div className="mt-4 space-y-3" data-testid="what-if-result">
          <div className="grid gap-3 md:grid-cols-2">
            <SideCard title="As proposed" side={result.comparison.base} />
            <SideCard title="Alternative" side={result.comparison.alternative} highlight={result.comparison.lower_risk} />
          </div>
          <div className="flex flex-wrap gap-4 text-sm text-slate-400">
            <span>
              Δ money <span className="font-mono text-slate-200">{inr(result.comparison.delta.money_out)}</span>
            </span>
            <span>
              Δ downstream <span className="font-mono text-slate-200">{result.comparison.delta.downstream_actions}</span>
            </span>
            <span>
              Δ risk <span className="font-mono text-slate-200">{result.comparison.delta.risk_score}</span>
            </span>
            <Link className="ml-auto text-indigo-300 hover:underline" to={`/simulate?action=${result.alternative.action.id}`}>
              Open the alternative →
            </Link>
          </div>
          <ExplanationCard explanation={result.comparison.explanation} />
        </div>
      )}
    </section>
  );
}
