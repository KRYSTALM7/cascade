import type { ActionStatus, Decision, PolicyReason, RiskLevel } from "../api/types";

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
  LOW: "bg-emerald-50 text-emerald-700 ring-emerald-600/30",
  MEDIUM: "bg-amber-50 text-amber-700 ring-amber-600/30",
  HIGH: "bg-orange-50 text-orange-700 ring-orange-600/30",
  CRITICAL: "bg-rose-50 text-rose-700 ring-rose-600/30",
};

export const DECISION_STYLE: Record<Decision, { label: string; style: string }> = {
  AUTO_APPROVED: { label: "Auto-approved", style: "bg-emerald-50 text-emerald-700 ring-emerald-600/30" },
  APPROVAL_REQUIRED: { label: "Approval required", style: "bg-amber-50 text-amber-700 ring-amber-600/30" },
  BLOCKED: { label: "Blocked", style: "bg-rose-50 text-rose-700 ring-rose-600/30" },
};

/** Big-verdict tones for the headline strip, risk block and approval gate. */
export const LEVEL_TEXT: Record<RiskLevel, string> = {
  LOW: "text-emerald-600",
  MEDIUM: "text-amber-600",
  HIGH: "text-orange-600",
  CRITICAL: "text-rose-600",
};

export const DECISION_TEXT: Record<Decision, string> = {
  AUTO_APPROVED: "text-emerald-600",
  APPROVAL_REQUIRED: "text-amber-600",
  BLOCKED: "text-rose-600",
};

export function statusLabel(status: ActionStatus): string {
  return status.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

export const humanTool = (toolId: string) => toolId.replace(/_/g, " ");

/** "Issue refund": a tool id as a sentence-case label. */
export const toolTitle = (toolId: string) => humanTool(toolId).replace(/^\w/, (c) => c.toUpperCase());

/** "Finance agent". */
export const agentName = (agentId: string) => `${agentStyle(agentId).label} agent`;

/** ₹72,000 — like `inr` but drops a zero paise part for headlines. Formatting only. */
export function inrShort(amount: string | null | undefined): string {
  const full = inr(amount);
  return full.endsWith(".00") ? full.slice(0, -3) : full;
}

/** Strip the sign of a backend decimal string (for "₹57,600 less" phrasing). */
export const absAmount = (amount: string) => amount.replace(/^-/, "");

const EVENT_TEXT: Record<string, string> = {
  ORDER_CANCELLED: "Order was cancelled",
  ORDER_MODIFIED: "Order was modified",
  ORDER_STATUS_CHANGED: "Order status changed",
  REFUND_REQUESTED: "Refund was requested",
  REFUND_ISSUED: "Refund was issued",
  COMPENSATION_ISSUED: "Compensation was issued",
  PAYMENT_REVERSED: "Payment was reversed",
  STOCK_RESERVED: "Stock was reserved",
  STOCK_RELEASED: "Stock was released",
  STOCK_BELOW_REORDER_POINT: "Stock fell below reorder point",
  CUSTOMER_STATUS_CHANGED: "Customer status changed",
  CASE_OPENED: "A case was opened",
};

/** "Order was modified" for ORDER_MODIFIED; unknown events fall back to a readable form of the raw name. */
export function humanEvent(event: string | null | undefined): string {
  if (!event) return "";
  return EVENT_TEXT[event] ?? event.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

const DONE_TEXT: Record<string, string> = {
  cancel_order: "Order cancelled",
  modify_order: "Order updated",
  update_order_status: "Order status updated",
  issue_refund: "Refund issued",
  request_refund: "Refund requested",
  issue_compensation: "Compensation issued",
  reverse_payment: "Payment reversed",
  release_inventory: "Inventory released to stock",
  reserve_inventory: "Inventory reserved",
  create_restock_request: "Restock requested",
  update_customer_status: "Customer status updated",
  send_customer_notification: "Customer notified",
  create_customer_case: "CRM case created",
};

/** Past-tense label for an applied execution step: "Refund issued". */
export const doneText = (toolId: string) => DONE_TEXT[toolId] ?? `${toolTitle(toolId)} done`;

function paramValue(key: string, value: unknown): string {
  if (key === "amount" && typeof value === "string") return inr(value);
  if (key === "percentage" && (typeof value === "string" || typeof value === "number")) return `${value}%`;
  if (key === "lines" && Array.isArray(value)) {
    return value
      .map((l) => (l && typeof l === "object" && "sku" in l && "quantity" in l ? `${String(l.sku)} → qty ${String(l.quantity)}` : JSON.stringify(l)))
      .join(", ");
  }
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** "order ORD-10550 · SKU-LAP-001 → qty 1": readable parameters (the raw JSON lives in Technical details). */
export function humanParams(params: Record<string, unknown>): string {
  return Object.entries(params)
    .map(([k, v]) => (k === "lines" ? paramValue(k, v) : `${k.replace(/_id$/, "").replace(/_/g, " ")} ${paramValue(k, v)}`))
    .join(" · ");
}

/** Strictness order of policy decisions, used only to word a comparison of two backend decisions. */
export const DECISION_RANK: Record<Decision, number> = { AUTO_APPROVED: 0, APPROVAL_REQUIRED: 1, BLOCKED: 2 };

const SEVERITY_ORDER: Record<PolicyReason["severity"], number> = { BLOCK: 0, APPROVAL: 1, INFO: 2 };

/** The backend's reasons, most decisive first (BLOCK, then APPROVAL, then INFO). Order only; nothing re-scored. */
export function topReasons(reasons: PolicyReason[], n = 3): PolicyReason[] {
  return [...reasons].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]).slice(0, n);
}
