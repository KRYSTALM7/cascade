import type { ActionStatus, Decision, RiskLevel } from "../api/types";

/** ₹84,500.00 — grouping only; the value is the backend's exact decimal string, never re-computed. */
export function inr(amount: string | null | undefined): string {
  if (amount === null || amount === undefined) return "—";
  const negative = amount.startsWith("-");
  const [whole = "0", frac = "00"] = amount.replace("-", "").split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "−" : ""}₹${grouped}.${frac.padEnd(2, "0").slice(0, 2)}`;
}

export const AGENT_STYLE: Record<string, { color: string; ring: string; text: string; label: string }> = {
  "customer-support": { color: "#38bdf8", ring: "ring-sky-400/60", text: "text-sky-300", label: "Support" },
  order: { color: "#a78bfa", ring: "ring-violet-400/60", text: "text-violet-300", label: "Order" },
  finance: { color: "#fbbf24", ring: "ring-amber-400/60", text: "text-amber-300", label: "Finance" },
  inventory: { color: "#34d399", ring: "ring-emerald-400/60", text: "text-emerald-300", label: "Inventory" },
  crm: { color: "#f472b6", ring: "ring-pink-400/60", text: "text-pink-300", label: "CRM" },
};

const FALLBACK = { color: "#94a3b8", ring: "ring-slate-400/60", text: "text-slate-300", label: "Agent" };
export const agentStyle = (agentId: string) => AGENT_STYLE[agentId] ?? FALLBACK;

export const LEVEL_STYLE: Record<RiskLevel, string> = {
  LOW: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/40",
  MEDIUM: "bg-amber-500/15 text-amber-300 ring-amber-500/40",
  HIGH: "bg-orange-500/15 text-orange-300 ring-orange-500/40",
  CRITICAL: "bg-rose-500/15 text-rose-300 ring-rose-500/40",
};

export const DECISION_STYLE: Record<Decision, { label: string; style: string }> = {
  AUTO_APPROVED: { label: "Auto-approved", style: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/40" },
  APPROVAL_REQUIRED: { label: "Approval required", style: "bg-amber-500/15 text-amber-300 ring-amber-500/40" },
  BLOCKED: { label: "Blocked", style: "bg-rose-500/15 text-rose-300 ring-rose-500/40" },
};

export function statusLabel(status: ActionStatus): string {
  return status.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

export const humanTool = (toolId: string) => toolId.replace(/_/g, " ");
