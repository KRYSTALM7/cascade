import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { api } from "../api/endpoints";
import type { ActionDetail } from "../api/types";
import { BlastRadius } from "../components/BlastRadius";
import { ClarificationPrompt } from "../components/ClarificationPrompt";
import { ConsequenceGraph } from "../components/ConsequenceGraph";
import { DecisionBar } from "../components/DecisionBar";
import { ErrorBanner } from "../components/ErrorBanner";
import { ExplanationCard } from "../components/ExplanationCard";
import { OrderState } from "../components/OrderState";
import { RiskPanel } from "../components/RiskPanel";
import { WhatIfPanel } from "../components/WhatIfPanel";
import { agentStyle, humanTool } from "../lib/format";
import { SCENARIOS } from "../lib/scenarios";
import { useUser } from "../lib/userContext";


const AGENTS = ["customer-support", "order", "finance", "inventory", "crm"];

function Composer({ onResult }: { onResult: (d: ActionDetail) => void }) {
  const { userId } = useUser();
  const [mode, setMode] = useState<"nl" | "form">("nl");
  const [agent, setAgent] = useState("customer-support");
  const [text, setText] = useState<string>(SCENARIOS[0].text);
  const [tool, setTool] = useState("cancel_order");
  const [params, setParams] = useState('{\n  "order_id": "ORD-10482"\n}');
  const tools = useQuery({ queryKey: ["tools"], queryFn: api.tools });

  const run = useMutation({
    mutationFn: async (input: { kind: "nl"; agent: string; text: string } | { kind: "form" }) => {
      if (input.kind === "nl") {
        const parsed = await api.parse(userId, input.agent, input.text);
        return parsed.action.status === "PARSED" ? api.simulateAction(userId, parsed.action.id) : parsed;
      }
      let parameters: Record<string, unknown>;
      try {
        parameters = JSON.parse(params) as Record<string, unknown>;
      } catch {
        throw new Error("Parameters must be valid JSON.");
      }
      return api.simulateStructured(userId, agent, tool, parameters);
    },
    onSuccess: onResult,
  });

  return (
    <section aria-label="Propose an action" className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Scenarios</span>
        {SCENARIOS.map((s) => (
          <button
            key={s.key}
            type="button"
            title={s.hint}
            aria-label={`${s.label} scenario`}
            disabled={run.isPending}
            onClick={() => {
              setMode("nl");
              setAgent(s.agent);
              setText(s.text);
              run.mutate({ kind: "nl", agent: s.agent, text: s.text });
            }}
            className="group rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-left text-sm hover:border-slate-500 disabled:opacity-50"
          >
            <span className="font-medium text-slate-100">{s.label}</span>
            <span className="ml-2 hidden text-xs text-slate-500 lg:inline">{s.hint}</span>
          </button>
        ))}
      </div>

      <div className="mt-4 flex gap-1 text-sm" role="tablist">
        {(["nl", "form"] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            type="button"
            onClick={() => setMode(m)}
            className={`rounded-md px-3 py-1 ${mode === m ? "bg-slate-700 text-white" : "text-slate-400 hover:text-slate-200"}`}
          >
            {m === "nl" ? "Natural language" : "Structured"}
          </button>
        ))}
      </div>

      <form
        className="mt-3 grid gap-3 md:grid-cols-[200px_1fr_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          run.mutate(mode === "nl" ? { kind: "nl", agent, text } : { kind: "form" });
        }}
      >
        <label className="text-sm">
          <span className="text-xs text-slate-500">Acting agent</span>
          <select aria-label="Acting agent" value={agent} onChange={(e) => setAgent(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-2" style={{ color: agentStyle(agent).color }}>
            {AGENTS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        {mode === "nl" ? (
          <label className="text-sm">
            <span className="text-xs text-slate-500">What should the agent do?</span>
            <input aria-label="Instruction" value={text} onChange={(e) => setText(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100" />
          </label>
        ) : (
          <div className="grid gap-2 sm:grid-cols-[200px_1fr]">
            <label className="text-sm">
              <span className="text-xs text-slate-500">Tool</span>
              <select aria-label="Tool" value={tool} onChange={(e) => setTool(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-2">
                {(tools.data ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.id}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="text-xs text-slate-500">Parameters (JSON)</span>
              <textarea aria-label="Parameters" value={params} onChange={(e) => setParams(e.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-slate-100" />
            </label>
          </div>
        )}
        <button type="submit" disabled={run.isPending} className="self-end rounded-lg bg-sky-500 px-5 py-2 font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50">
          {run.isPending ? "Simulating…" : "Simulate"}
        </button>
      </form>
      {run.error && (
        <div className="mt-3">
          <ErrorBanner error={run.error} />
        </div>
      )}
    </section>
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
  const orderId = typeof action.parameters.order_id === "string" ? action.parameters.order_id : null;
  const markers = action.interpretation?.injection_markers ?? [];

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-xl font-semibold">
          <span style={{ color: agentStyle(action.agent_id).color }}>{action.agent_id}</span>
          <span className="text-slate-500"> → </span>
          {action.tool_id ? humanTool(action.tool_id) : "unparsed request"}
          {orderId && <span className="text-slate-400"> {orderId}</span>}
        </h2>
        {action.raw_text && <span className="text-sm italic text-slate-500">“{action.raw_text}”</span>}
        {action.parent_action_id && <span className="text-xs text-indigo-300">what-if alternative</span>}
      </header>

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
          The world changed since this simulation, so nothing was applied.
          <button type="button" onClick={() => resimulate.mutate()} className="rounded-md bg-orange-500 px-3 py-1 font-medium text-slate-950">
            Re-simulate
          </button>
        </div>
      )}

      {report && risk && decision && (
        <>
          <DecisionBar detail={detail} onChange={onChange} />
          <BlastRadius radius={report.blast_radius} />
          <ConsequenceGraph report={report} />
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <RiskPanel risk={risk} reasons={decision.reasons} />
            <div className="space-y-4">
              {detail.explanation && <ExplanationCard explanation={detail.explanation} />}
              {orderId && <OrderState orderId={orderId} report={report} />}
            </div>
          </div>
          {decision.decision !== "BLOCKED" && <WhatIfPanel actionId={action.id} />}
        </>
      )}
    </div>
  );
}

export function SimulatePage() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const actionId = params.get("action");
  const detail = useQuery({ queryKey: ["action", actionId], queryFn: () => api.action(actionId ?? ""), enabled: !!actionId });

  const show = (d: ActionDetail) => {
    queryClient.setQueryData(["action", d.action.id], d);
    void queryClient.invalidateQueries({ queryKey: ["actions"] });
    setParams({ action: d.action.id });
  };

  return (
    <div className="space-y-6">
      <Composer onResult={show} />
      {detail.error && <ErrorBanner error={detail.error} />}
      {detail.data ? (
        <ActionView detail={detail.data} onChange={show} />
      ) : (
        !actionId && (
          <p className="rounded-xl border border-dashed border-slate-800 p-10 text-center text-slate-500">
            Pick a scenario or describe an action. Cascade shows what <em>else</em> would happen before anything runs.
          </p>
        )
      )}
    </div>
  );
}
