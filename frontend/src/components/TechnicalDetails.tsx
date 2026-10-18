import { Link } from "react-router";
import type { ActionDetail } from "../api/types";
import { CausalChain } from "./CausalChain";
import { ExplanationCard } from "./ExplanationCard";
import { RiskDetails } from "./RiskPanel";

function Meta({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <>
      <dt className="text-slate-500">{label}</dt>
      <dd className="break-all font-mono text-slate-700">{value}</dd>
    </>
  );
}

/** Everything an engineer may want to check, kept out of the main story. Collapsed by default. */
export function TechnicalDetails({ detail }: { detail: ActionDetail }) {
  const { action, report, risk, decision, explanation } = detail;
  if (!report) return null;
  const engineNotes = [...report.blocking, ...report.warnings];
  return (
    <details data-testid="technical-details" className="group rounded-xl border border-slate-200 bg-slate-50">
      <summary className="cursor-pointer list-none px-5 py-3 text-sm font-medium text-slate-700 hover:text-slate-900">
        <span className="mr-2 inline-block transition group-open:rotate-90">▸</span>
        <span>Technical details</span> <span className="text-slate-500">· reaction rules, events, risk weights, reason codes, fingerprints, raw parameters</span>
      </summary>
      <div className="space-y-4 border-t border-slate-200 bg-white p-4">
        <CausalChain report={report} />
        <div className="grid gap-4 lg:grid-cols-2">
          {risk && decision && <RiskDetails risk={risk} reasons={decision.reasons} />}
          <div className="space-y-4">
            {explanation && <ExplanationCard explanation={explanation} label="Narrative" />}
            <section aria-label="Simulation metadata" className="rounded-lg border border-slate-200 bg-white p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Simulation record</h3>
              <dl className="mt-2 grid grid-cols-[140px_1fr] gap-x-3 gap-y-1 text-xs">
                <Meta label="Action id" value={action.id} />
                <Meta label="Agent · tool" value={`${action.agent_id} · ${action.tool_id ?? "—"}`} />
                <Meta label="Parser" value={action.parser} />
                <Meta label="Proposed by" value={action.proposed_by} />
                <Meta label="Parameters" value={JSON.stringify(action.parameters)} />
                <Meta label="Engine" value={report.engine_version} />
                <Meta label="Report fingerprint" value={report.fingerprint} />
                <Meta label="Rules fingerprint" value={report.config?.rules_fingerprint} />
                <Meta label="Catalog fingerprint" value={report.config?.catalog_fingerprint} />
                <Meta label="Policy" value={decision?.policy_version} />
                <Meta label="Execution order" value={report.execution_order.join(" → ")} />
                <Meta label="Limits" value={`${report.limit_reached ? "cascade limit reached" : "within cascade limit"} · ${report.cycle_detected ? "cycle cut" : "no cycle"}`} />
              </dl>
              {engineNotes.length > 0 && (
                <ul className="mt-3 space-y-1 text-xs text-slate-600">
                  {engineNotes.map((n, i) => (
                    <li key={`${n.code}-${i}`}>
                      <span className="font-mono text-slate-500">{n.code}</span> {n.message}
                    </li>
                  ))}
                </ul>
              )}
              <Link to="/audit" className="mt-3 inline-block text-xs text-primary-600 hover:underline">
                Open the append-only audit log →
              </Link>
            </section>
          </div>
        </div>
      </div>
    </details>
  );
}
