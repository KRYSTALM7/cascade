import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { api } from "../api/endpoints";
import { ErrorBanner } from "../components/ErrorBanner";

const EVENTS = [
  "",
  "ACTION_PARSED",
  "ACTION_PROPOSED",
  "CLARIFICATION_REQUESTED",
  "INJECTION_SUSPECTED",
  "ACTION_SIMULATED",
  "DECISION_MADE",
  "APPROVAL_REQUESTED",
  "APPROVED",
  "REJECTED",
  "APPROVAL_DENIED",
  "APPROVAL_EXPIRED",
  "EXECUTED",
  "PARTIALLY_EXECUTED",
  "EXECUTION_FAILED",
  "STALE_STATE_DETECTED",
  "LLM_OUTPUT_INVALID",
  "WHAT_IF_COMPARED",
];

export function AuditPage() {
  const [eventType, setEventType] = useState("");
  const audit = useQuery({ queryKey: ["audit", eventType], queryFn: () => api.audit(eventType || undefined), refetchInterval: 5000 });

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-700">Audit log · append-only</h2>
        <select aria-label="Event type" value={eventType} onChange={(e) => setEventType(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm text-slate-900">
          {EVENTS.map((e) => (
            <option key={e} value={e}>
              {e || "All events"}
            </option>
          ))}
        </select>
      </div>
      {audit.error && <ErrorBanner error={audit.error} />}
      <div className="overflow-x-auto">
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider bg-slate-100 border-b border-slate-200">
              <th className="py-2 px-3 font-semibold text-slate-700">#</th>
              <th className="py-2 px-3 font-semibold text-slate-700">Event</th>
              <th className="py-2 px-3 font-semibold text-slate-700">Actor</th>
              <th className="py-2 px-3 font-semibold text-slate-700">Action</th>
              <th className="py-2 px-3 font-semibold text-slate-700">Details</th>
            </tr>
          </thead>
          <tbody>
            {(audit.data ?? []).map((e) => (
              <tr key={e.id} className="border-b border-slate-200 hover:bg-slate-50 transition-colors align-top">
                <td className="py-2 px-3 font-mono text-xs text-slate-600">{e.id}</td>
                <td className="py-2 px-3 font-mono text-xs text-slate-900">{e.event_type}</td>
                <td className="py-2 px-3 text-xs text-slate-700">
                  {e.actor_type.toLowerCase()} {e.actor_id}
                </td>
                <td className="py-2 px-3 font-mono text-xs">
                  {e.action_id ? (
                    <Link to={`/simulate?action=${e.action_id}`} className="text-primary-600 hover:underline">
                      {e.action_id.slice(0, 8)}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="max-w-xl truncate py-2 px-3 font-mono text-[11px] text-slate-600" title={JSON.stringify(e.payload)}>
                  {JSON.stringify(e.payload)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 text-xs text-slate-600 md:hidden">← Scroll to see all columns</div>
    </section>
  );
}
