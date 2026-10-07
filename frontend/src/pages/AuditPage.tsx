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
    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Audit log · append-only</h2>
        <select aria-label="Event type" value={eventType} onChange={(e) => setEventType(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-sm">
          {EVENTS.map((e) => (
            <option key={e} value={e}>
              {e || "All events"}
            </option>
          ))}
        </select>
      </div>
      {audit.error && <ErrorBanner error={audit.error} />}
      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500">
            <th className="py-2 font-medium">#</th>
            <th className="py-2 font-medium">Event</th>
            <th className="py-2 font-medium">Actor</th>
            <th className="py-2 font-medium">Action</th>
            <th className="py-2 font-medium">Details</th>
          </tr>
        </thead>
        <tbody>
          {(audit.data ?? []).map((e) => (
            <tr key={e.id} className="border-t border-slate-800/80 align-top">
              <td className="py-2 font-mono text-xs text-slate-500">{e.id}</td>
              <td className="py-2 font-mono text-xs text-slate-200">{e.event_type}</td>
              <td className="py-2 text-xs text-slate-400">
                {e.actor_type.toLowerCase()} {e.actor_id}
              </td>
              <td className="py-2 font-mono text-xs">
                {e.action_id ? (
                  <Link to={`/simulate?action=${e.action_id}`} className="text-sky-300 hover:underline">
                    {e.action_id.slice(0, 8)}
                  </Link>
                ) : (
                  "—"
                )}
              </td>
              <td className="max-w-xl truncate py-2 font-mono text-[11px] text-slate-500" title={JSON.stringify(e.payload)}>
                {JSON.stringify(e.payload)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
