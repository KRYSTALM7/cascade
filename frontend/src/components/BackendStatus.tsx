import { useEffect, useState } from "react";
import { ApiError, NETWORK_ERROR } from "../api/client";
import { getReadiness } from "../api/health";

export type BackendState =
  | { kind: "checking" }
  | { kind: "ready" }
  | { kind: "degraded"; message: string }
  | { kind: "unreachable" };

const STYLES: Record<BackendState["kind"], { dot: string; label: string }> = {
  checking: { dot: "bg-slate-400 animate-pulse", label: "Checking backend…" },
  ready: { dot: "bg-emerald-400", label: "Backend ready" },
  degraded: { dot: "bg-amber-400", label: "Backend degraded" },
  unreachable: { dot: "bg-rose-500", label: "Backend unreachable" },
};

export function BackendStatus() {
  const [state, setState] = useState<BackendState>({ kind: "checking" });

  useEffect(() => {
    const controller = new AbortController();
    getReadiness(controller.signal)
      .then(() => setState({ kind: "ready" }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof ApiError && err.code !== NETWORK_ERROR) {
          setState({ kind: "degraded", message: err.message });
        } else {
          setState({ kind: "unreachable" });
        }
      });
    return () => controller.abort();
  }, []);

  const style = STYLES[state.kind];
  return (
    <div role="status" className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-sm">
      <span aria-hidden className={`h-2 w-2 rounded-full ${style.dot}`} />
      <span>{style.label}</span>
      {state.kind === "degraded" && <span className="text-slate-600">— {state.message}</span>}
    </div>
  );
}
