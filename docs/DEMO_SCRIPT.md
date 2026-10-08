# Demo script — 3 minutes

**Setup (before judges arrive):** `docker compose up --build` (or the dev servers), open <http://localhost:5173>, click **Reset demo** (top right). The header must say **Backend ready**; the amber **Demo mode** pill (full notice at the foot of the page) says the app runs on demo identities, not production auth. Acting user: **Ravi · Support Ops (operator)**. Approvals expire after 30 minutes, so simulate live rather than leaving a result open in advance; an expired approval shows **Re-simulate**.

One line to open with:

> "Permissions ask *can Agent A call Tool B?* Cascade asks *if Agent A calls Tool B with these parameters, what happens next?* — before anything runs."

---

### 0:00 – 1:20 · The hidden cascade: the first tool was allowed; the problem is what happens after it

1. The first screen asks **"What happens if this agent acts?"**: **Support agent → Modify order ORD-10550 → Reduce laptops: 2 → 1**. Click **Simulate consequences**. The sentence *"Change the laptop quantity to 1 on ORD-10550, customer only needs one"* is parsed and simulated. Nothing has executed. The stepper at the top shows where we are.
2. **Proposed action:** Support agent wants to *modify order* ORD-10550 — **✓ Authorized**. A quantity edit, fully reversible.
3. **Blast radius** (the headline): **3 agents affected · 5 downstream actions · ₹72,000 exposure · HIGH · 68 · Approval required**. Under it: *"The dangerous part isn't the action we authorized. It's what other agents do after it."*
   Left card — **On its own: looks safe** — **LOW · 10/100 · Auto-approved · ₹0**. "Without Cascade, this is safe."
   Right card — **With what happens next** — **HIGH · 68/100 · Approval required · ₹72,000**. Records, systems, customer impact and data sensitivity are under *More impact details*.
4. **How we got there** (consequence graph + legend): the root *proposed this action*; every other node is an agent that **reacted & proposed** its own action, each **✓ Allowed** under its own permission. "Nobody scripted these steps." Below the graph, in plain words: *Finance agent saw "Order was modified" and proposed → Issue refund ₹72,000.00 → ✓ Allowed — Finance refunds the difference when an order gets cheaper.* "Support is not allowed to refund — Finance is. It was not a workflow step; it was another agent reacting."
5. **Risk & policy decision:** **HIGH RISK · 68 / 100**, the top reasons ("₹72,000.00 would leave NovaCart, above the ₹2,000.00 auto-approve limit", "Risk is HIGH (68/100)"), then **APPROVAL REQUIRED**.
6. Optional for technical judges: open **Technical details** at the bottom: `finance.refund_on_downsize@1` if `TOTAL_DECREASED`, risk weights, reason codes, fingerprints.

### 1:20 – 1:40 · Is there a safer option?

7. **Is there a safer option?** → suggested **Keep both laptops, offer 10% compensation** → **Compare this alternative**: **Lower-risk alternative** — ₹14,400 exposure · 1 downstream action · MEDIUM risk (₹57,600 less exposure, HIGH 68 → MEDIUM 52). Say the trade-off out loud, as the UI does: it is a different action that does not preserve what the customer asked for, it is irreversible, and it still needs approval — Cascade shows the trade-off; a human chooses. The backend computes every number. (20% would be ₹28,800, still HIGH under the high-value floor — which is why the preset is 10%.)

### 1:40 – 2:15 · A real control gate — approval is bound to what the approver saw

8. **Approval gate:** why, amount **₹72,000**, risk **HIGH · 68/100**, requested by **Support agent on behalf of Ravi**, a live expiry countdown. As Ravi (an operator) there is no approve button — the gate says *Approval requires an authorized approver* and offers **Act as Asha Menon** / **Act as Dev Patel**.
9. **Act as Dev Patel** (limit ₹10,000) → **Approve & Execute**: red alert `APPROVAL_LIMIT_EXCEEDED`; nothing ran.
10. Acting user → **Asha · Finance Lead** → **Approve & Execute** → **Executed**. Execution locked the rows, re-simulated, compared state *and* policy/rule/permission fingerprints, then applied exactly the previewed changes: ✓ Order updated, ✓ Inventory released to stock, ✓ Refund issued, ✓ Customer notified, ✓ CRM case created. The order's **Now** column matches the simulated after.

### 2:15 – 3:00 · It can't be talked out of its rules

11. **Try another → Support issues a refund**: root **BLOCKED · TOOL_NOT_PERMITTED** — no approve button exists.
12. **Escape room** (secondary nav) → **Run attack** on each card: poisoned instruction (blocked, injection audited), unauthorized downstream (blocked on the CRM node, not the root), state tampering (409 `STALE_STATE`), conflicting instructions (first executes, second stale).
13. Close on **Audit**: every parse, decision, approval (with what it was bound to), denial and execution, with request ids.

> "Deterministic engines decide; the LLM only parses and explains. The dangerous action wasn't the one we authorized. It was the one that happened after it."

---

**Persona:** starting any scenario (or a replay) while acting as Asha proposes it as Ravi and says so in a blue notice under the header — approvers never request, so Asha can always approve. If you deliberately write your own request as Asha, the gate offers **Propose again as Ravi**.

**Public URL:** on the public deployment (`PUBLIC_MODE`) visitors cannot reset the data or run Escape Room attacks; reset between judges with the presenter token (`docs/DEPLOY.md` §7) and show the Escape Room from the local stack.

**If something goes wrong:** **Reset demo** restores NovaCart in under a second; after executing the flagship, **Reset demo data & run this again** (in the Execution card) replays it from a clean state. If Gemini is slow or down, nothing changes: the rules provider is the default, and the Structured tab (under *Write your own action*) never needs an LLM. **Cancel a small order** (₹1,998 → executes without a human) is a 10-second backup scenario; **Cancel a VIP order** has a 20% compensation what-if (₹84,500 → ₹16,900). The Escape Room's conflicting-instructions card consumes ORD-10540, and executing the hidden cascade consumes ORD-10550's second laptop; reset before replaying either.
