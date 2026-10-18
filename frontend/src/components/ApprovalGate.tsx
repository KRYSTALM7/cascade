import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "../api/endpoints";
import type { ActionDetail, DemoUser } from "../api/types";
import { useProposeAgain } from "../lib/demoActions";
import { LEVEL_TEXT, agentName, inr, inrShort, topReasons } from "../lib/format";
import { REQUESTER_ID, requesterLabel, useUser } from "../lib/userContext";
import { StatusBadge } from "./Badges";
import { ErrorBanner } from "./ErrorBanner";

const EXECUTABLE = new Set(["AUTO_APPROVED", "APPROVED", "FAILED"]);

function useNow(intervalMs: number, enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs, enabled]);
  return now;
}

function countdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Display name for a demo user id; the id itself when the directory has not loaded. */
function useDirectory() {
  const users = useQuery({ queryKey: ["users"], queryFn: api.users, staleTime: 60_000 });
  const list: DemoUser[] = Array.isArray(users.data) ? users.data : [];
  const byId = new Map(list.map((u) => [u.id, u]));
  return { list, loaded: list.length > 0, name: (id: string | null | undefined) => (id ? (byId.get(id)?.name ?? id) : "—"), get: (id: string) => byId.get(id) };
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">{label}</dt>
      <dd className="mt-0.5 text-slate-900">{children}</dd>
    </div>
  );
}

const ROLE_LABEL: Record<DemoUser["role"], string> = { VIEWER: "Viewer", OPERATOR: "Operator", APPROVER: "Approver" };

/** Approval + execution control gate. Every rule (role, limit, self-approval, expiry) is enforced by the
 * backend; the gate only explains who can act and relays the backend's answer. */
export function ApprovalGate({ detail, onChange }: { detail: ActionDetail; onChange: (d: ActionDetail) => void }) {
  const { userId, setUserId } = useUser();
  const queryClient = useQueryClient();
  const directory = useDirectory();
  const { action, approval, decision, risk } = detail;
  const id = action.id;
  const status = action.status;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["order"] });
    void queryClient.invalidateQueries({ queryKey: ["actions"] });
  };
  const mutation = useMutation({
    mutationFn: async (verb: "approve" | "reject" | "execute" | "approve-execute") => {
      if (verb !== "approve-execute") return api[verb](userId, id);
      const approved = await api.approve(userId, id);
      onChange(approved);
      return api.execute(userId, id);
    },
    onSuccess: (next) => {
      onChange(next);
      refresh();
    },
    onError: refresh,
  });
  const again = useProposeAgain(action);
  const busy = mutation.isPending;

  const pending = status === "PENDING_APPROVAL";
  const now = useNow(1000, pending);
  const remaining = approval ? Date.parse(approval.expires_at) - now : Infinity;
  const windowClosed = pending && remaining <= 0;

  const me = directory.get(userId);
  const isRequester = !!action.proposed_by && action.proposed_by === userId;
  const otherApprovers = directory.list.filter((u) => u.role === "APPROVER" && u.id !== action.proposed_by && u.id !== userId);
  // Hide buttons that would predictably fail with a role/self-approval error; the backend still decides.
  const canDecide = !directory.loaded || (me?.role === "APPROVER" && !isRequester);

  const reasons = decision ? topReasons(decision.reasons.filter((r) => r.severity !== "INFO"), 2) : [];
  const resimulate = (
    <button
      type="button"
      disabled={again.isPending}
      onClick={() => again.mutate()}
      className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50"
    >
      {again.isPending ? "Simulating…" : "Re-simulate"}
    </button>
  );

  let title: string;
  let tone: string;
  let color = "text-slate-900";
  let subtitle: ReactNode = null;
  let body: ReactNode = null;

  if (pending && !windowClosed) {
    title = "APPROVAL REQUIRED";
    color = "text-amber-700";
    tone = "border-amber-300 bg-amber-50";
    subtitle = "Nothing runs until an authorized human approves.";
    body = (
      <>
        <dl className="grid gap-4 grid-cols-2 min-[360px]:grid-cols-2 md:grid-cols-5">
          <div className="col-span-2 md:col-span-2">
            <Fact label="Why approval is needed">
              <ul className="space-y-0.5 text-sm">
                {reasons.map((r, i) => (
                  <li key={`${r.code}-${i}`} title={r.code}>
                    {r.message}
                  </li>
                ))}
              </ul>
            </Fact>
          </div>
          <Fact label="Amount">
            <span className="text-xl font-bold tabular-nums text-amber-700 break-words">{decision ? inrShort(decision.money_out) : "—"}</span>
          </Fact>
          <Fact label="Risk">
            {risk ? (
              <span className={`text-xl font-bold tabular-nums ${LEVEL_TEXT[risk.level]}`}>
                {risk.level} · {risk.score}/100
              </span>
            ) : (
              "—"
            )}
          </Fact>
          <Fact label="Expires in">
            <span data-testid="approval-countdown" className="text-xl font-bold tabular-nums break-words">
              {approval ? countdown(remaining) : "—"}
            </span>
            {approval && <span className="block text-xs text-slate-600 break-words">at {new Date(approval.expires_at).toLocaleTimeString()}</span>}
          </Fact>
        </dl>
        <dl className="mt-4">
          <Fact label="Requested by">
            <span data-testid="requested-by">
              {agentName(action.agent_id)} · on behalf of <span className="font-medium">{directory.name(action.proposed_by)}</span>
            </span>
          </Fact>
        </dl>

        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-amber-200 pt-4">
          {canDecide ? (
            <>
              <span className="text-sm text-slate-600">
                Acting as <span className="font-medium text-slate-900">{directory.name(userId)}</span>
                {me?.approval_limit && <span className="text-slate-600"> · may approve up to {inr(me.approval_limit)}</span>}
              </span>
              <div className="ml-auto flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => mutation.mutate("reject")}
                  className="rounded-lg border border-rose-300 px-5 py-2.5 font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                >
                  Reject
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => mutation.mutate("approve")}
                  className="rounded-lg border border-emerald-300 px-4 py-2.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                >
                  Approve only
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => mutation.mutate("approve-execute")}
                  className="rounded-lg bg-emerald-600 px-6 py-2.5 font-semibold text-white shadow-lg shadow-emerald-600/20 hover:bg-emerald-700 disabled:opacity-50"
                >
                  {busy ? "Working…" : "Approve & Execute"}
                </button>
              </div>
            </>
          ) : (
            <div data-testid="persona-guide" className="w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
              <p className="text-slate-900">
                You&apos;re acting as <span className="font-semibold">{directory.name(userId)}</span>
                {me && <span className="text-slate-600"> · {ROLE_LABEL[me.role]}</span>}.
              </p>
              <p className="mt-0.5 text-slate-700">
                {me && me.role !== "APPROVER"
                  ? "Approval requires an authorized approver."
                  : "You requested this action, so you cannot approve it yourself. A different approver must decide."}
              </p>
              {isRequester && userId !== REQUESTER_ID && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    data-testid="propose-as-requester"
                    disabled={again.isPending}
                    onClick={() => again.mutate()}
                    className="rounded-lg bg-sky-500 px-3 py-1.5 text-sm font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50"
                  >
                    {again.isPending ? "Proposing…" : `Propose again as ${requesterLabel}`}
                  </button>
                  <span className="text-xs text-slate-600">then switch back to approve it</span>
                </div>
              )}
              {otherApprovers.length > 0 && (
                <div className="mt-3 flex flex-col md:flex-row md:flex-wrap md:items-center gap-2">
                  <span className="text-xs text-slate-600">Switch persona:</span>
                  {otherApprovers.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => setUserId(u.id)}
                      className="w-full md:w-auto min-h-[44px] rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm text-emerald-700 hover:bg-emerald-100"
                    >
                      Act as {u.name}
                      {u.approval_limit && <span className="text-emerald-600"> · up to {inrShort(u.approval_limit)}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </>
    );
  } else if (windowClosed || status === "EXPIRED") {
    title = "APPROVAL EXPIRED";
    color = "text-orange-700";
    tone = "border-orange-300 bg-orange-50";
    subtitle = "Nobody decided within the approval window, so nothing ran. Simulate the same request again for a fresh, current decision.";
    body = <div className="flex gap-2">{resimulate}</div>;
  } else if (status === "REJECTED") {
    title = "REJECTED";
    color = "text-rose-700";
    tone = "border-rose-300 bg-rose-50";
    subtitle = (
      <>
        Rejected by <span className="font-medium text-slate-900">{directory.name(approval?.decided_by)}</span>. Nothing ran.
      </>
    );
    body = (
      <div className="flex flex-wrap items-center gap-3">
        {resimulate}
        <a href="#step-whatif" className="text-sm text-indigo-600 hover:underline">
          Look for a safer option ↓
        </a>
      </div>
    );
  } else if (status === "BLOCKED") {
    title = "BLOCKED";
    color = "text-rose-700";
    tone = "border-rose-300 bg-rose-50";
    subtitle = "This action cannot be approved or executed.";
    body = (
      <ul className="space-y-1 text-sm text-rose-800">
        {reasons.map((r, i) => (
          <li key={`${r.code}-${i}`} title={r.code}>
            {r.message}
          </li>
        ))}
      </ul>
    );
  } else if (status === "AUTO_APPROVED") {
    title = "AUTO-APPROVED";
    color = "text-emerald-700";
    tone = "border-emerald-300 bg-emerald-50";
    subtitle = "Within policy limits: no human approval is needed.";
  } else if (status === "APPROVED") {
    title = "APPROVED";
    color = "text-emerald-700";
    tone = "border-emerald-300 bg-emerald-50";
    subtitle = (
      <>
        Approved by <span className="font-medium text-slate-900">{directory.name(approval?.decided_by)}</span>. Ready to execute.
      </>
    );
  } else if (status === "EXECUTED" || status === "PARTIALLY_EXECUTED") {
    title = status === "EXECUTED" ? "EXECUTED" : "PARTIALLY EXECUTED";
    color = status === "EXECUTED" ? "text-emerald-700" : "text-amber-700";
    tone = "border-emerald-300 bg-emerald-50";
    subtitle = approval?.decided_by ? (
      <>
        Approved by <span className="font-medium text-slate-900">{directory.name(approval.decided_by)}</span>, then executed.
      </>
    ) : (
      "Auto-approved, then executed."
    );
  } else if (status === "FAILED") {
    title = "EXECUTION FAILED";
    color = "text-rose-700";
    tone = "border-rose-300 bg-rose-50";
    subtitle = "The execution did not complete. See the steps below; you can retry.";
  } else if (status === "STALE") {
    title = "STALE";
    color = "text-orange-700";
    tone = "border-orange-300 bg-orange-50";
    subtitle = "The data changed since this simulation. Re-simulate above before deciding.";
  } else {
    title = status.replace(/_/g, " ");
    tone = "border-slate-200 bg-white";
  }

  return (
    <section id="step-approval" aria-label="Approval gate" className={`scroll-mt-24 rounded-2xl border-2 p-5 ${tone}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-600">Approval gate</div>
          <div className={`text-2xl font-extrabold tracking-wide ${color}`}>{title}</div>
          {subtitle && <p className="mt-0.5 text-sm text-slate-700">{subtitle}</p>}
        </div>
        <StatusBadge status={status} />
      </div>
      {body && <div className="mt-4">{body}</div>}
      {EXECUTABLE.has(status) && (
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            disabled={busy}
            onClick={() => mutation.mutate("execute")}
            className="rounded-lg bg-sky-500 px-6 py-2.5 font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50"
          >
            {status === "FAILED" ? "Retry execution" : "Execute"}
          </button>
        </div>
      )}
      {(mutation.error || again.error) && (
        <div className="mt-3">
          <ErrorBanner error={mutation.error ?? again.error} />
        </div>
      )}
    </section>
  );
}
