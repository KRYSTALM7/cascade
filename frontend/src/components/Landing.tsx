import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { api } from "../api/endpoints";
import type { ActionDetail } from "../api/types";
import { parseAndSimulate, useAsRequester, useResetDemo, useShowAction } from "../lib/demoActions";
import { useDeployment } from "../lib/deployment";
import { agentName, agentStyle } from "../lib/format";
import { HERO, SCENARIOS, type Scenario } from "../lib/scenarios";
import { useUser } from "../lib/userContext";
import { ErrorBanner } from "./ErrorBanner";

const AGENTS = ["customer-support", "order", "finance", "inventory", "crm"];

// `asIs`: propose as the current persona ("Write your own"); otherwise as the scenario requester.
type RunInput = { kind: "nl"; agent: string; text: string; asIs?: boolean } | { kind: "form"; agent: string; tool: string; params: string };

/** One mutation for every way of proposing an action; the result opens on the Simulate page. */
function useRun() {
  const { userId } = useUser();
  const asRequester = useAsRequester();
  const show = useShowAction();
  return useMutation({
    mutationFn: async (input: RunInput): Promise<ActionDetail> => {
      if (input.kind === "nl") return parseAndSimulate(input.asIs ? userId : asRequester(), input.agent, input.text);
      let parameters: Record<string, unknown>;
      try {
        parameters = JSON.parse(input.params) as Record<string, unknown>;
      } catch {
        throw new Error("Parameters must be valid JSON.");
      }
      return api.simulateStructured(userId, input.agent, input.tool, parameters);
    },
    onSuccess: show,
  });
}

function ScenarioCard({ scenario, busy, onRun, flagship }: { scenario: Scenario; busy: boolean; onRun: () => void; flagship?: boolean }) {
  const style = agentStyle(scenario.agent);
  return (
    <button
      type="button"
      aria-label={`${scenario.label} scenario`}
      disabled={busy}
      onClick={onRun}
      className="group flex h-full flex-col rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-left transition hover:border-slate-600 hover:bg-slate-900 disabled:opacity-50"
    >
      <span className="flex items-center gap-2 text-[11px] font-semibold" style={{ color: style.color }}>
        {agentName(scenario.agent)}
        {flagship && <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-sky-200 ring-1 ring-sky-400/40">Flagship</span>}
      </span>
      <span className="mt-1 font-medium text-slate-100">{scenario.label}</span>
      <span className="mt-0.5 text-xs text-slate-400">{scenario.hint}</span>
    </button>
  );
}

/** The power-user path: free text or a structured tool call. Secondary on purpose. */
function WriteYourOwn({ run }: { run: ReturnType<typeof useRun> }) {
  const [mode, setMode] = useState<"nl" | "form">("nl");
  const [agent, setAgent] = useState("customer-support");
  const [text, setText] = useState("");
  const [tool, setTool] = useState("cancel_order");
  const [params, setParams] = useState('{\n  "order_id": "ORD-10482"\n}');
  const tools = useQuery({ queryKey: ["tools"], queryFn: api.tools });

  return (
    <details className="group rounded-xl border border-slate-800 bg-slate-900/40">
      <summary className="cursor-pointer list-none px-4 py-3 text-sm text-slate-300 hover:text-slate-100">
        <span className="mr-2 inline-block transition group-open:rotate-90">▸</span>
        Write your own action <span className="text-slate-500">· natural language or a structured tool call</span>
      </summary>
      <div className="border-t border-slate-800 px-4 pb-4 pt-3">
        <div className="flex gap-1 text-sm" role="tablist">
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
            run.mutate(mode === "nl" ? { kind: "nl", agent, text, asIs: true } : { kind: "form", agent, tool, params });
          }}
        >
          <label className="text-sm">
            <span className="text-xs text-slate-500">Acting agent</span>
            <select
              aria-label="Acting agent"
              value={agent}
              onChange={(e) => setAgent(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-2"
              style={{ color: agentStyle(agent).color }}
            >
              {AGENTS.map((a) => (
                <option key={a} value={a}>
                  {agentName(a)} ({a})
                </option>
              ))}
            </select>
          </label>
          {mode === "nl" ? (
            <label className="text-sm">
              <span className="text-xs text-slate-500">What should the agent do?</span>
              <input
                aria-label="Instruction"
                value={text}
                placeholder="e.g. Cancel ORD-10482, customer wants out"
                onChange={(e) => setText(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 placeholder:text-slate-600"
              />
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
                <textarea
                  aria-label="Parameters"
                  value={params}
                  onChange={(e) => setParams(e.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-slate-100"
                />
              </label>
            </div>
          )}
          <p className="text-xs text-slate-500 md:col-span-3 md:row-start-2">Demo environment — use synthetic data only. Anything typed here is stored and visible to other visitors.</p>
          <button
            type="submit"
            disabled={run.isPending || (mode === "nl" && !text.trim())}
            className="self-end rounded-lg bg-sky-500 px-5 py-2 font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50"
          >
            {run.isPending ? "Simulating…" : "Simulate"}
          </button>
        </form>
      </div>
    </details>
  );
}

function ResetHint() {
  const reset = useResetDemo();
  if (useDeployment().publicMode) {
    return <p className="text-xs text-slate-500">Executing a scenario changes NovaCart&apos;s shared demo data. On this public demo only the presenter can reset it.</p>;
  }
  return (
    <p className="text-xs text-slate-500">
      Executing a scenario changes NovaCart&apos;s demo data.{" "}
      <button type="button" onClick={() => reset.mutate(undefined)} disabled={reset.isPending} className="text-sky-300 hover:underline disabled:opacity-50">
        {reset.isPending ? "Resetting…" : "Reset demo data"}
      </button>{" "}
      to replay any scenario from a clean state.
      {reset.error && <span className="ml-2 text-rose-300">{String(reset.error)}</span>}
    </p>
  );
}

/** First screen: one concrete agent proposal and what Cascade will do with it. */
export function Landing() {
  const run = useRun();
  const hero = HERO.scenario;
  const style = agentStyle(hero.agent);
  const runScenario = (s: Scenario) => run.mutate({ kind: "nl", agent: s.agent, text: s.text });

  return (
    <div className="space-y-6">
      <section aria-label="Proposed agent action" className="rounded-3xl border border-slate-800 bg-gradient-to-b from-slate-900 to-slate-950 px-6 py-10 text-center sm:px-10">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-300">Consequence simulation before execution</div>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">What happens if this agent acts?</h1>
        <p className="mx-auto mt-3 max-w-2xl text-slate-400">
          An AI agent has proposed an action. Before anything runs, Cascade simulates how every other agent reacts — money, systems and customer data —
          and decides whether it is safe, blocked, or needs a human.
        </p>

        <div className="mx-auto mt-8 flex max-w-3xl flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-center sm:gap-3" data-testid="hero-proposal">
          <div className="rounded-xl border bg-slate-950 px-4 py-3 text-left" style={{ borderColor: style.color }}>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Agent</div>
            <div className="font-semibold" style={{ color: style.color }}>
              {agentName(hero.agent)}
            </div>
          </div>
          <span aria-hidden className="text-center text-xl text-slate-600">
            →
          </span>
          <div className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-left">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Proposes</div>
            <div className="font-semibold text-slate-100">{HERO.action}</div>
          </div>
          <span aria-hidden className="text-center text-xl text-slate-600">
            →
          </span>
          <div className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-left">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Change</div>
            <div className="font-semibold text-slate-100">{HERO.detail}</div>
          </div>
        </div>
        <p className="mt-3 text-sm italic text-slate-500">“{hero.text}”</p>

        <button
          type="button"
          onClick={() => runScenario(hero)}
          disabled={run.isPending}
          className="mt-6 rounded-xl bg-sky-500 px-8 py-3 text-lg font-semibold text-slate-950 shadow-lg shadow-sky-500/20 hover:bg-sky-400 disabled:opacity-50"
        >
          {run.isPending ? "Simulating…" : "Simulate consequences"}
        </button>
        <p className="mt-2 text-xs text-slate-500">Nothing is executed. Cascade only simulates until a policy or a human says go.</p>
        {run.error && (
          <div className="mx-auto mt-4 max-w-2xl text-left">
            <ErrorBanner error={run.error} />
          </div>
        )}
      </section>

      <section aria-label="Scenarios" className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-300">Or try another situation</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SCENARIOS.map((s) => (
            <ScenarioCard key={s.key} scenario={s} busy={run.isPending} onRun={() => runScenario(s)} flagship={s === hero} />
          ))}
        </div>
        <ResetHint />
      </section>

      <WriteYourOwn run={run} />
      <p className="text-center text-xs text-slate-600">
        Looking for the internals? See the <Link to="/agents" className="hover:text-slate-400 hover:underline">agents &amp; reaction rules</Link>,{" "}
        <Link to="/audit" className="hover:text-slate-400 hover:underline">audit log</Link> or the{" "}
        <Link to="/escape-room" className="hover:text-slate-400 hover:underline">escape room</Link>.
      </p>
    </div>
  );
}

/** Compact scenario switcher above a result. */
export function ScenarioStrip() {
  const run = useRun();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link to="/simulate" className="mr-2 rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-slate-500 hover:text-white">
        ← New simulation
      </Link>
      <span className="text-xs text-slate-500">Try another:</span>
      {SCENARIOS.map((s) => (
        <button
          key={s.key}
          type="button"
          title={s.hint}
          aria-label={`${s.label} scenario`}
          disabled={run.isPending}
          onClick={() => run.mutate({ kind: "nl", agent: s.agent, text: s.text })}
          className="rounded-full border border-slate-800 bg-slate-900 px-3 py-1 text-xs text-slate-300 hover:border-slate-600 hover:text-white disabled:opacity-50"
        >
          {s.label}
        </button>
      ))}
      {run.isPending && <span className="text-xs text-slate-400">Simulating…</span>}
      {run.error && (
        <div className="w-full">
          <ErrorBanner error={run.error} />
        </div>
      )}
    </div>
  );
}
