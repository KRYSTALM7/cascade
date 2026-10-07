/** One-click demo scenarios (natural language, parsed by the backend like any other request). */
export const SCENARIOS = [
  { key: "high", label: "High", hint: "Cancel the ₹84,500 VIP order", agent: "customer-support", text: "Cancel ORD-10482, customer wants out" },
  { key: "medium", label: "Medium", hint: "Watch 1→2: stock dips below reorder", agent: "customer-support", text: "Change the watch quantity to 2 on ORD-10495" },
  { key: "low", label: "Low", hint: "Shipping SMS, nothing cascades", agent: "crm", text: "Send CUST-1005 an SMS that ORD-10501 has shipped" },
  { key: "unauthorized", label: "Unauthorized", hint: "Support tries to issue a refund", agent: "customer-support", text: "Issue a refund for ORD-10482" },
  { key: "auto", label: "Auto-approve", hint: "₹1,998 cancel, under the limit", agent: "customer-support", text: "Cancel ORD-10510" },
] as const;
