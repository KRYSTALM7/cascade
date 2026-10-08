/** One-click demo scenarios (natural language, parsed by the backend like any other request).
 *
 * Labels describe the situation, never the outcome: the judge should discover the outcome.
 * `whatIf` presets were checked against the real backend (rules provider, seeded NovaCart);
 * the comparison itself is always computed by the backend at click time, never stored here. */
export interface WhatIfPreset {
  /** Button text. */
  label: string;
  /** Sent to the backend's what-if parser. */
  text: string;
}

export interface Scenario {
  key: string;
  label: string;
  hint: string;
  agent: string;
  text: string;
  whatIf?: WhatIfPreset;
}

export const SCENARIOS: readonly Scenario[] = [
  {
    key: "hidden",
    label: "Trim a laptop order",
    hint: "The customer only needs one of the two laptops on ORD-10550",
    agent: "customer-support",
    text: "Change the laptop quantity to 1 on ORD-10550, customer only needs one",
    // 20% (₹28,800) stays HIGH under the high-value floor; 10% (₹14,400) is genuinely lower risk.
    whatIf: { label: "Keep both laptops, offer 10% compensation", text: "What if we keep the order and give 10% compensation instead?" },
  },
  {
    key: "vip-cancel",
    label: "Cancel a VIP order",
    hint: "A VIP customer wants out of ORD-10482 (₹84,500)",
    agent: "customer-support",
    text: "Cancel ORD-10482, customer wants out",
    whatIf: { label: "Keep the order, offer 20% compensation", text: "What if we give 20% compensation instead?" },
  },
  {
    key: "add-watch",
    label: "Add a second watch",
    hint: "Bump the watch on ORD-10495 from 1 to 2",
    agent: "customer-support",
    text: "Change the watch quantity to 2 on ORD-10495",
  },
  {
    key: "shipping-sms",
    label: "Send a shipping SMS",
    hint: "CRM tells CUST-1005 that ORD-10501 has shipped",
    agent: "crm",
    text: "Send CUST-1005 an SMS that ORD-10501 has shipped",
  },
  {
    key: "support-refund",
    label: "Support issues a refund",
    hint: "The Support agent tries to refund ORD-10482 directly",
    agent: "customer-support",
    text: "Issue a refund for ORD-10482",
  },
  {
    key: "small-cancel",
    label: "Cancel a small order",
    hint: "A customer cancels ORD-10510 (₹1,998)",
    agent: "customer-support",
    text: "Cancel ORD-10510",
  },
];

/** The flagship: a reversible edit whose real risk only appears downstream. */
export const HERO = {
  scenario: SCENARIOS[0]!,
  action: "Modify order ORD-10550",
  detail: "Reduce laptops: 2 → 1",
};

/** The scenario an action was started from (matched on agent + exact text), if any. */
export function scenarioFor(agentId: string, rawText: string | null): Scenario | undefined {
  return rawText ? SCENARIOS.find((s) => s.agent === agentId && s.text === rawText) : undefined;
}
