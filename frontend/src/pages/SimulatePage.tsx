import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React from "react";
import { Link, useLocation, useSearchParams } from "react-router";
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
import { KPISummary } from "../components/KPISummary";
import { ProposedAction } from "../components/ProposedAction";
import { RiskPanel } from "../components/RiskPanel";
import { TechnicalDetails } from "../components/TechnicalDetails";
import { WhatIfPanel } from "../components/WhatIfPanel";
import ActionExplorer from "../components/ActionExplorer";
import type { ActionDefinition } from "../data/actionCatalog";
import { parseAndSimulate, useAsRequester, useResetDemo, useShowAction } from "../lib/demoActions";
import { useDeployment } from "../lib/deployment";
import { agentName, agentStyle, humanTool } from "../lib/format";
import { SCENARIOS, scenarioFor } from "../lib/scenarios";
import { useUser } from "../lib/userContext";

/** Simulation interface: input form and result viewer */
function SimulationInput() {
  const asRequester = useAsRequester();
  const show = useShowAction();
  const location = useLocation();
  
  // Accept initial state from landing page navigation
  const initialAgent = (location.state as { agent?: string })?.agent ?? "customer-support";
  const initialText = (location.state as { text?: string })?.text ?? "";
  
  const [agent, setAgent] = React.useState(initialAgent);
  const [text, setText] = React.useState(initialText);
  const [showHelp, setShowHelp] = React.useState(false);
  
  // Auto-submit if coming from landing page with pre-filled values
  const hasAutoSubmitted = React.useRef(false);
  React.useEffect(() => {
    if (!hasAutoSubmitted.current && initialText.trim() && location.state) {
      hasAutoSubmitted.current = true;
      parseAndSimulate(asRequester(), initialAgent, initialText).then(show);
    }
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps
  
  const simulate = useMutation({
    mutationFn: async () => parseAndSimulate(asRequester(), agent, text),
    onSuccess: show,
  });

  const AGENTS = ["customer-support", "order", "finance", "inventory", "crm"];

  const handleActionSelect = (action: ActionDefinition) => {
    // Set agent based on action's owner
    const agentMap: Record<string, string> = {
      "Customer Support Agent": "customer-support",
      "Order Agent": "order",
      "Finance Agent": "finance",
      "Inventory Agent": "inventory",
      "CRM Agent": "crm",
    };
    const mappedAgent = agentMap[action.agent] || "customer-support";
    setAgent(mappedAgent);
    
    // Use the first example as the text
    if (action.examples.length > 0 && action.examples[0]) {
      setText(action.examples[0]);
    }
    
    // Close help panel and scroll to input
    setShowHelp(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-slate-900">Simulate an action</h1>
          <p className="mt-2 text-slate-600">
            Choose an agent and describe what it should do. Cascade will simulate the consequences.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowHelp(!showHelp)}
          className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
        >
          <span className="text-lg">{showHelp ? '✕' : '❓'}</span>
          {showHelp ? 'Close' : 'Decision Guide'}
        </button>
      </div>

      {showHelp && (
        <div className="space-y-6 rounded-xl border border-blue-200 bg-blue-50 p-6">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 mb-3">
              Decision Guide
            </h2>
            <div className="space-y-3 text-sm text-slate-700">
              <div className="flex gap-3">
                <span className="text-xl">1️⃣</span>
                <div>
                  <strong>Select an Acting Agent:</strong> Choose which agent should perform the action. Each agent has different permissions and capabilities (customer-support, finance, inventory, etc.).
                </div>
              </div>
              <div className="flex gap-3">
                <span className="text-xl">2️⃣</span>
                <div>
                  <strong>Describe the Action:</strong> Write what the agent should do in plain language (e.g., "Cancel ORD-10482" or "Issue refund for ORD-10550").
                </div>
              </div>
              <div className="flex gap-3">
                <span className="text-xl">3️⃣</span>
                <div>
                  <strong>Understand Consequence Simulation:</strong> Cascade simulates what would happen without making real changes. It shows all downstream effects across agents, tools, and data.
                </div>
              </div>
              <div className="flex gap-3">
                <span className="text-xl">4️⃣</span>
                <div>
                  <strong>Review Risk Assessment:</strong> Each action receives a risk score based on money movement, reversibility, customer impact, affected agents, and data sensitivity.
                </div>
              </div>
              <div className="flex gap-3">
                <span className="text-xl">5️⃣</span>
                <div>
                  <strong>Interpret the Decision:</strong>
                  <ul className="mt-2 space-y-1 ml-4">
                    <li><strong>AUTO_APPROVED (green):</strong> Low risk, executes automatically</li>
                    <li><strong>APPROVAL_REQUIRED (yellow):</strong> Needs human approval before execution</li>
                    <li><strong>BLOCKED (red):</strong> Not permitted by policy or authorization rules</li>
                  </ul>
                </div>
              </div>
              <div className="flex gap-3">
                <span className="text-xl">⚠️</span>
                <div>
                  <strong>Simulation vs. Execution:</strong> Simulating an action analyzes consequences but does not execute it. Only approved actions that pass all checks are actually executed in the demo environment.
                </div>
              </div>
            </div>
          </div>

          <ActionExplorer onSelectAction={handleActionSelect} />
        </div>
      )}

      {/* Quick Scenarios */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-slate-700">Quick scenarios:</span>
        {SCENARIOS.slice(0, 4).map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => {
              setAgent(s.agent);
              setText(s.text);
            }}
            className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700 transition-colors"
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Input Form */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) simulate.mutate();
        }}
        className="space-y-4"
      >
        <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
          <label className="space-y-2">
            <span className="text-sm font-medium text-slate-700">Acting agent</span>
            <select
              value={agent}
              onChange={(e) => setAgent(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
              style={{ color: agentStyle(agent).color }}
            >
              {AGENTS.map((a) => (
                <option key={a} value={a}>
                  {agentName(a)}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2">
            <span className="text-sm font-medium text-slate-700">What should the agent do?</span>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="e.g. Cancel ORD-10482, customer wants out"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
            />
          </label>
        </div>

        <button
          type="submit"
          disabled={simulate.isPending || !text.trim()}
          className="rounded-lg bg-gradient-to-r from-primary-500 to-primary-600 px-6 py-2.5 font-semibold text-white shadow-lg shadow-primary-500/25 hover:shadow-xl hover:shadow-primary-500/30 disabled:opacity-50 disabled:shadow-none transition-all"
        >
          {simulate.isPending ? "Simulating…" : "Simulate consequences"}
        </button>
      </form>

      {simulate.error && <ErrorBanner error={simulate.error} />}
    </div>
  );
}

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
    <div className="space-y-6">
      {/* Back Navigation */}
      <div className="flex items-center gap-3">
        <Link to="/simulate" className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-colors">
          ← New simulation
        </Link>
        {action.parent_action_id && (
          <Link
            to={`/simulate?action=${action.parent_action_id}`}
            className="text-sm text-primary-600 hover:underline"
          >
            ← Back to original action
          </Link>
        )}
      </div>

      {!report && (
        <h2 className="text-xl font-semibold text-slate-900">
          <span style={{ color: agentStyle(action.agent_id).color }}>{agentName(action.agent_id)}</span>
          <span className="text-slate-600"> → </span>
          {action.tool_id ? humanTool(action.tool_id) : "unparsed request"}
          {action.raw_text && <span className="ml-3 text-sm font-normal italic text-slate-600">"{action.raw_text}"</span>}
        </h2>
      )}

      {markers.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-200">
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
        <div className="flex items-center justify-between rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-700">
          The business state or the policy, rules or permissions it depended on changed since this simulation, so nothing was applied.
          <button type="button" onClick={() => resimulate.mutate()} className="rounded-lg bg-orange-500 px-4 py-2 font-semibold text-white hover:bg-orange-600 transition-colors">
            Re-simulate
          </button>
        </div>
      )}

      {root?.status_code === "NO_CHANGE" && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-700">
          This order already has this change, most likely from an earlier run of this scenario.
          {publicMode ? (
            <span className="text-sky-600">On this public instance, only the presenter can reset the shared data.</span>
          ) : (
            <button
              type="button"
              onClick={() => reset.mutate(action)}
              disabled={reset.isPending}
              className="rounded-lg bg-sky-500 px-4 py-2 font-semibold text-white disabled:opacity-50 hover:bg-sky-600 transition-colors"
            >
              {reset.isPending ? "Resetting…" : "Reset & run again"}
            </button>
          )}
          {reset.error && <ErrorBanner error={reset.error} />}
        </div>
      )}

      {report && risk && decision && root && (
        <>
          <FlowStepper detail={detail} />
          <KPISummary detail={detail} />
          <ProposedAction action={action} root={root} />
          <BlastRadius radius={report.blast_radius} direct={report.direct_effect} risk={risk} decision={decision.decision} explanation={detail.explanation} />
          
          <section id="step-graph" aria-label="Consequence graph section" className="scroll-mt-24 space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-primary-600">Consequence Graph</div>
              <h3 className="mt-0.5 text-lg font-bold text-slate-900">How we got there</h3>
              <p className="mt-1 text-sm text-slate-600">
                Each agent observed an event and decided whether to act under its own permissions.
              </p>
            </div>
            <GraphLegend />
            <ConsequenceGraph report={report} />
            <details className="group">
              <summary className="cursor-pointer list-none text-sm font-medium text-slate-600 hover:text-slate-900">
                <span className="mr-2 inline-block transition group-open:rotate-90">▸</span>
                View as text chain
              </summary>
              <div className="mt-3">
                <PlainChain report={report} />
              </div>
            </details>
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

  const update = (d: ActionDetail) => {
    if (d.action.id !== actionId) return show(d);
    queryClient.setQueryData(["action", d.action.id], d);
    void queryClient.invalidateQueries({ queryKey: ["actions"] });
  };

  if (!actionId) return <SimulationInput />;
  
  return (
    <div className="space-y-6">
      {detail.error && <ErrorBanner error={detail.error} />}
      {detail.isPending && <p className="text-slate-600">Loading simulation…</p>}
      {detail.data && <ActionView key={detail.data.action.id} detail={detail.data} onChange={update} />}
    </div>
  );
}
