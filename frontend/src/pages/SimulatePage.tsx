import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { api } from "../api/endpoints";
import type { ActionDetail } from "../api/types";
import { ApprovalGate } from "../components/ApprovalGate";
import { BlastRadius } from "../components/BlastRadius";
import { PlainChain } from "../components/CausalChain";
import { ClarificationPrompt } from "../components/ClarificationPrompt";
import { ConsequenceGraph, GraphLegend } from "../components/ConsequenceGraph";
import { ErrorBanner } from "../components/ErrorBanner";
import { Execution } from "../components/Execution";
import { FlowStepper } from "../components/FlowStepper";
import { Landing, ScenarioStrip } from "../components/Landing";
import { ProposedAction } from "../components/ProposedAction";
import { RiskPanel } from "../components/RiskPanel";
import { TechnicalDetails } from "../components/TechnicalDetails";
import { WhatIfPanel } from "../components/WhatIfPanel";
import { useResetDemo, useShowAction } from "../lib/demoActions";
import { useDeployment } from "../lib/deployment";
import { agentName, agentStyle, humanTool } from "../lib/format";
import { scenarioFor } from "../lib/scenarios";
import { useUser } from "../lib/userContext";

function ActionView({ detail, onChange }: { detail: ActionDetail; onChange: (d: ActionDetail) => void }) {
  const { userId } = useUser();
  const { action, report, risk, decision } = detail;
  const clarify = useMutation({
    mutationFn: async (answers: Record<string, string>) => {
      const next = await api.clarify(userId, action.id, answers);
      return next.action.status === "PARSED" ? api.simulateAction(userId, next.action.id) : next;
    },
    onSuccess: onChange,
  });
  const resimulate = useMutation({ mutationFn: () => api.simulateAction(userId, action.id), onSuccess: onChange });
  const reset = useResetDemo();
  const { publicMode } = useDeployment();
  const markers = action.interpretation?.injection_markers ?? [];
  const root = report?.nodes[0];
  const scenario = scenarioFor(action.agent_id, action.raw_text);

  return (
    <div className="space-y-5">
      {action.parent_action_id && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-3 py-2 text-sm text-indigo-200">
          This is a what-if alternative to an earlier proposal.
          <Link to={`/simulate?action=${action.parent_action_id}`} className="font-medium text-indigo-100 underline-offset-2 hover:underline">
            ← Back to the original action
          </Link>
        </div>
      )}
      {!report && (
        <h2 className="text-xl font-semibold">
          <span style={{ color: agentStyle(action.agent_id).color }}>{agentName(action.agent_id)}</span>
          <span className="text-slate-500"> → </span>
          {action.tool_id ? humanTool(action.tool_id) : "unparsed request"}
          {action.raw_text && <span className="ml-3 text-sm font-normal italic text-slate-500">“{action.raw_text}”</span>}
        </h2>
      )}

      {markers.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          Prompt-injection markers detected and audited ({markers.join(" · ")}). The text was treated as data; the acting agent comes from the request.
        </div>
      )}

      {action.status === "NEEDS_CLARIFICATION" && action.clarification && (
        <>
          <ClarificationPrompt clarification={action.clarification} busy={clarify.isPending} onAnswer={(a) => clarify.mutate(a)} />
          {clarify.error && <ErrorBanner error={clarify.error} />}
        </>
      )}

      {action.status === "STALE" && (
        <div className="flex items-center justify-between rounded-lg border border-orange-500/40 bg-orange-500/10 px-3 py-2 text-sm text-orange-200">
          The business state or the policy, rules or permissions it depended on changed since this simulation, so nothing was applied.
          <button type="button" onClick={() => resimulate.mutate()} className="rounded-md bg-orange-500 px-3 py-1 font-medium text-slate-950">
            Re-simulate
          </button>
        </div>
      )}

      {root?.status_code === "NO_CHANGE" && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-sm text-sky-100">
          This order already has this change, most likely from an earlier run of this scenario.
          {publicMode ? (
            <span className="text-sky-200/80">On this public demo, only the presenter can reset the shared data.</span>
          ) : (
          <button
            type="button"
            onClick={() => reset.mutate(action)}
            disabled={reset.isPending}
            className="rounded-md bg-sky-500 px-3 py-1 font-medium text-slate-950 disabled:opacity-50"
          >
            {reset.isPending ? "Resetting…" : "Reset demo data & run again"}
          </button>
          )}
          {reset.error && <ErrorBanner error={reset.error} />}
        </div>
      )}

      {report && risk && decision && root && (
        <>
          <FlowStepper detail={detail} />
          <ProposedAction action={action} root={root} />
          <BlastRadius radius={report.blast_radius} direct={report.direct_effect} risk={risk} decision={decision.decision} explanation={detail.explanation} />
          <section id="step-graph" aria-label="Consequence graph section" className="scroll-mt-24 space-y-3 rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-400">Consequence graph</div>
              <h3 className="text-xl font-semibold text-slate-100">How we got there</h3>
              <p className="mt-1 text-sm text-slate-400">
                Nobody scripted these steps. Each agent observed an event and decided whether to act under its own permissions.
              </p>
            </div>
            <GraphLegend />
            <ConsequenceGraph report={report} />
            <PlainChain report={report} />
          </section>
          <RiskPanel risk={risk} reasons={decision.reasons} decision={decision.decision} />
          <ApprovalGate detail={detail} onChange={onChange} />
          {decision.decision !== "BLOCKED" && <WhatIfPanel key={action.id} actionId={action.id} baseToolId={action.tool_id} preset={scenario?.whatIf} />}
          <Execution detail={detail} />
          <TechnicalDetails detail={detail} />
        </>
      )}
    </div>
  );
}

export function SimulatePage() {
  const [params] = useSearchParams();
  const queryClient = useQueryClient();
  const show = useShowAction();
  const actionId = params.get("action");
  const detail = useQuery({ queryKey: ["action", actionId], queryFn: () => api.action(actionId ?? ""), enabled: !!actionId });

  // Same action (approve, execute, clarify…): update in place; a different one (re-simulate): navigate.
  const update = (d: ActionDetail) => {
    if (d.action.id !== actionId) return show(d);
    queryClient.setQueryData(["action", d.action.id], d);
    void queryClient.invalidateQueries({ queryKey: ["actions"] });
  };

  if (!actionId) return <Landing />;
  return (
    <div className="space-y-5">
      <ScenarioStrip />
      {detail.error && <ErrorBanner error={detail.error} />}
      {detail.isPending && <p className="text-slate-500">Loading simulation…</p>}
      {detail.data && <ActionView key={detail.data.action.id} detail={detail.data} onChange={update} />}
    </div>
  );
}
