import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { api } from "../api/endpoints";
import type { EscapeResult, EscapeScenario } from "../api/types";
import { ErrorBanner } from "../components/ErrorBanner";

function ScenarioCard({ scenario }: { scenario: EscapeScenario }) {
  const [result, setResult] = useState<EscapeResult | null>(null);
  const run = useMutation({ mutationFn: () => api.runScenario(scenario.id), onSuccess: setResult });

  return (
    <article data-testid={`scenario-${scenario.id}`} className="flex flex-col rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-semibold text-slate-100">{scenario.title}</h3>
        <button
          type="button"
          onClick={() => run.mutate()}
          disabled={run.isPending}
          className="shrink-0 rounded-lg bg-rose-500 px-3 py-1 text-sm font-semibold text-white hover:bg-rose-400 disabled:opacity-50"
        >
          {run.isPending ? "Attacking…" : "Run attack"}
        </button>
      </div>
      <p className="mt-2 text-sm text-slate-400">{scenario.attack}</p>
      <dl className="mt-3 grid grid-cols-[90px_1fr] gap-y-1 text-sm">
        <dt className="text-slate-500">Expected</dt>
        <dd className="font-mono text-slate-200">
          {scenario.expected_outcome} <span className="text-slate-500">· {scenario.expected_code}</span>
        </dd>
        <dt className="text-slate-500">Actual</dt>
        <dd data-testid="actual" className={`font-mono ${result ? (result.passed ? "text-emerald-300" : "text-rose-300") : "text-slate-600"}`}>
          {result ? `${result.actual_outcome} · ${result.actual_code ?? "—"}` : "not run yet"}
        </dd>
      </dl>
      {result && (
        <div className="mt-3 space-y-2">
          <div className={`rounded-md px-2 py-1 text-sm font-semibold ${result.passed ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300"}`}>
            {result.passed ? "✓ Caught" : "✗ Not caught as expected"}
          </div>
          <ol className="list-decimal space-y-0.5 pl-5 text-xs text-slate-400">
            {result.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-2 text-xs">
            {result.action_ids.map((id) => (
              <Link key={id} to={`/simulate?action=${id}`} className="text-sky-300 hover:underline">
                open action {id.slice(0, 8)} →
              </Link>
            ))}
          </div>
        </div>
      )}
      {run.error && (
        <div className="mt-3">
          <ErrorBanner error={run.error} />
        </div>
      )}
      <p className="mt-auto pt-3 text-xs text-slate-500">
        <span className="font-semibold text-slate-400">Caught by:</span> {scenario.caught_by}
      </p>
    </article>
  );
}

export function EscapeRoomPage() {
  const scenarios = useQuery({ queryKey: ["escape-room"], queryFn: api.escapeRoom });
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Escape room</h2>
        <p className="text-sm text-slate-400">
          Scripted attacks replayed through the normal pipeline — no special engine. Reset the demo to replay scenarios that change orders.
        </p>
      </div>
      {scenarios.error && <ErrorBanner error={scenarios.error} />}
      <div className="grid gap-4 md:grid-cols-2">
        {(scenarios.data ?? []).map((s) => (
          <ScenarioCard key={s.id} scenario={s} />
        ))}
      </div>
    </div>
  );
}
