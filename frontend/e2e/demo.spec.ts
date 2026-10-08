import { expect, test, type Page } from "@playwright/test";

/** The judge's path through Cascade, end to end, with the offline rules provider. */

const BACKEND = process.env.E2E_BACKEND_URL ?? "http://localhost:8000";
const FLAGSHIP_TEXT = "Change the laptop quantity to 1 on ORD-10550, customer only needs one";

test.beforeEach(async ({ request, page }) => {
  const reset = await request.post(`${BACKEND}/api/demo/reset`);
  expect(reset.ok(), "backend must run with DEMO_MODE=true").toBeTruthy();
  await page.addInitScript(() => window.localStorage.setItem("cascade.user", "ops-ravi"));
});

async function actAs(page: Page, userId: string) {
  await page.getByLabel("Acting user").selectOption(userId);
}

const status = (page: Page) => page.getByTestId("action-status");

test("hidden cascade: an authorized, low-risk edit triggers Finance's ₹72,000 refund → approval required, nothing executed", async ({ page, request }) => {
  await page.goto("/simulate");
  // The landing leads with the flagship proposal; one click simulates it with seeded data.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("What happens if this agent acts?");
  await expect(page.getByTestId("hero-proposal")).toContainText("Modify order ORD-10550");
  await page.getByRole("button", { name: "Simulate consequences" }).click();
  await expect(status(page)).toHaveText("Pending approval");

  // The blast radius headline, straight from the backend.
  const headline = page.getByTestId("blast-headline");
  for (const text of ["Agents affected3", "Downstream actions5", "Exposure₹72,000", "RiskHIGH · 68", "DecisionApproval required"]) {
    await expect(headline).toContainText(text);
  }
  // 1. The proposal itself is authorized and, alone, would be auto-approved.
  await expect(page.getByTestId("root-authorization")).toHaveText("✓ Authorized");
  await expect(page.getByTestId("contrast-alone")).toContainText("LOW·10/100·Auto-approved·₹0");
  // 2. What happens next: Finance, under its own permission, refunds ₹72,000.
  await expect(page.getByTestId("contrast-cascade")).toContainText("HIGH·68/100·Approval required·₹72,000");
  await expect(page.getByTestId("blast-contrast")).toContainText("₹72,000.00 out");
  await expect(page.getByRole("list", { name: "Graph legend" })).toBeVisible();
  await expect(page.getByTestId("graph-node-n0")).toContainText("proposed this action");
  const refund = page.getByTestId("graph-node-n2");
  await expect(refund).toContainText("reacted & proposed");
  await expect(refund.getByTestId("node-auth")).toHaveText("✓ Allowed");
  await expect(refund.getByTestId("money-badge")).toHaveText("−₹72,000.00");
  await expect(page.getByTestId("plain-n2")).toContainText("Finance agent");
  await expect(page.getByTestId("plain-n2")).toContainText("✓ Allowed");
  // Risk and decision are unmissable; the technical chain is one click away.
  await expect(page.getByTestId("risk-score")).toHaveText("68");
  await expect(page.getByTestId("decision-banner")).toContainText("APPROVAL REQUIRED");
  await page.getByText("Technical details", { exact: true }).click();
  await expect(page.getByTestId("chain-n2")).toContainText("finance.refund_on_downsize@1");
  await expect(page.getByTestId("chain-n2")).toContainText("✓ granted");
  await expect(page.getByRole("list", { name: "Decision reasons" })).toContainText("REFUND_ABOVE_AUTO_LIMIT");
  // 3. Nothing ran.
  const order = (await (await request.get(`${BACKEND}/api/orders/ORD-10550`)).json()) as { total_amount: string };
  expect(order.total_amount).toBe("144000.00");
});

test("hero: NL cancel → graph → approval → approve → execute → order cancelled → audit", async ({ page }) => {
  await page.goto("/simulate");
  await page.getByRole("button", { name: "Cancel a VIP order scenario" }).click();

  // Parsed + simulated: the whole cascade is visible before anything runs.
  await expect(status(page)).toHaveText("Pending approval");
  await expect(page).toHaveURL(/\/simulate\?action=/);
  for (const id of ["n0", "n1", "n2", "n3", "n4", "n5"]) {
    await expect(page.getByTestId(`graph-node-${id}`)).toBeVisible();
  }
  await expect(page.getByTestId("graph-node-n1").getByTestId("money-badge")).toHaveText("−₹84,500.00");
  await expect(page.getByTestId("risk-score")).toHaveText("76");
  await expect(page.getByRole("region", { name: "Blast radius" })).toContainText("₹84,500.00");
  await expect(page.getByRole("list", { name: "Top reasons" })).toContainText("auto-approve limit");
  await expect(page.getByRole("region", { name: "Explanation" })).toContainText("human approver must decide");
  await expect(page.getByTestId("now-Order status")).toHaveText("CONFIRMED");
  await expect(page.getByTestId("nothing-ran")).toContainText("Nothing has run yet");

  // The operator is guided to an approver instead of being offered a button that would fail.
  const gate = page.getByRole("region", { name: "Approval gate" });
  await expect(gate.getByTestId("persona-guide")).toContainText("Approval requires an authorized approver.");
  await expect(gate.getByRole("button", { name: /Approve/ })).toHaveCount(0);
  await expect(gate.getByTestId("requested-by")).toContainText("Ravi Kumar");
  await gate.getByRole("button", { name: /Act as Asha Menon/ }).click();
  await expect(page.getByLabel("Acting user")).toHaveValue("approver-asha");
  await gate.getByRole("button", { name: "Approve only" }).click();
  await expect(status(page)).toHaveText("Approved");

  await actAs(page, "ops-ravi");
  await page.getByRole("button", { name: "Execute" }).click();
  await expect(status(page)).toHaveText("Executed");
  await expect(page.getByTestId("now-Order status")).toHaveText("CANCELLED");
  await expect(page.getByRole("list", { name: "Execution steps" })).toContainText("Refund issued");

  const actionId = new URL(page.url()).searchParams.get("action");
  await page.getByRole("link", { name: "View the audit trail →" }).click();
  const rows = page.locator("tbody tr", { hasText: actionId?.slice(0, 8) ?? "" });
  for (const event of ["ACTION_PARSED", "DECISION_MADE", "APPROVED", "EXECUTED"]) {
    await expect(rows.filter({ hasText: event }).first()).toBeVisible();
  }
});

test("a low-limit approver is refused with the backend's reason", async ({ page }) => {
  await page.goto("/simulate");
  await page.getByRole("button", { name: "Cancel a VIP order scenario" }).click();
  await expect(status(page)).toHaveText("Pending approval");
  await actAs(page, "approver-dev");
  await page.getByRole("button", { name: "Approve & Execute" }).click();
  await expect(page.getByRole("alert")).toContainText("APPROVAL_LIMIT_EXCEEDED");
  await expect(status(page)).toHaveText("Pending approval");
});

test("unauthorized: support cannot issue a refund — blocked, nothing to approve", async ({ page }) => {
  await page.goto("/simulate");
  await page.getByRole("button", { name: "Support issues a refund scenario" }).click();
  await expect(status(page)).toHaveText("Blocked");
  const root = page.getByTestId("graph-node-n0");
  await expect(root).toHaveAttribute("data-status", "BLOCKED");
  await expect(root).toContainText("TOOL_NOT_PERMITTED");
  await expect(page.getByTestId("decision-banner")).toContainText("BLOCKED");
  await expect(page.getByRole("button", { name: /Approve/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Execute" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "What if" })).toHaveCount(0);
});

test("auto-approve: the ₹1,998 cancel runs without a human", async ({ page }) => {
  await page.goto("/simulate");
  await page.getByRole("button", { name: "Cancel a small order scenario" }).click();
  await expect(status(page)).toHaveText("Auto approved");
  await page.getByRole("button", { name: "Execute" }).click();
  await expect(status(page)).toHaveText("Executed");
});

test("what-if: 20% compensation instead of cancelling is lower risk", async ({ page }) => {
  await page.goto("/simulate");
  await page.getByRole("button", { name: "Cancel a VIP order scenario" }).click();
  await expect(status(page)).toHaveText("Pending approval");
  await page.getByRole("textbox", { name: "Alternative" }).fill("What if we give 20% compensation instead?");
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  const result = page.getByTestId("what-if-result");
  await expect(result).toContainText("₹16,900.00");
  await expect(result).toContainText("₹84,500.00");
  await expect(result.getByRole("region", { name: "Explanation" })).toContainText("lower risk");
  const originalUrl = page.url();
  await result.getByRole("link", { name: "Open the alternative →" }).click();
  await expect(page.getByRole("heading", { level: 2 })).toContainText("issue compensation");
  await page.getByRole("link", { name: "← Back to the original action" }).click();
  await expect(page).toHaveURL(originalUrl);
});

test("what-if: the flagship's own preset is shown honestly as a lower-risk trade-off, not a recommendation", async ({ page }) => {
  await page.goto("/simulate");
  await page.getByRole("button", { name: "Simulate consequences" }).click();
  await expect(status(page)).toHaveText("Pending approval");
  const whatIf = page.getByRole("region", { name: "What if" });
  await expect(whatIf).toContainText("Is there a safer option?");
  await expect(whatIf).toContainText("Keep both laptops, offer 10% compensation");
  await whatIf.getByRole("button", { name: "Compare this alternative" }).click();
  const verdict = page.getByTestId("what-if-verdict");
  // Lower exposure and risk, but a different action, fully irreversible, still approval-gated:
  // shown as a trade-off, never as "Recommended".
  await expect(verdict).toContainText("Lower-risk alternative");
  await expect(page.getByTestId("what-if-summary")).toHaveText("₹14,400 exposure · 1 downstream action · MEDIUM risk");
  await expect(verdict).toContainText("₹57,600 less exposure");
  await expect(verdict).toContainText("4 fewer downstream actions");
  await expect(verdict).toContainText("Lower risk: HIGH 68 → MEDIUM 52");
  const tradeoffs = page.getByTestId("what-if-tradeoffs");
  await expect(tradeoffs).toContainText("does not preserve the originally requested outcome");
  await expect(tradeoffs).toContainText("Irreversible");
  await expect(tradeoffs).toContainText("Approval still required");
  await expect(page.getByTestId("recommended")).toHaveCount(0);
});

test("persona: starting the flagship while acting as Asha proposes as Ravi, so Asha can approve — also after a replay", async ({ page }) => {
  await page.goto("/simulate");
  await actAs(page, "approver-asha");
  await page.getByRole("button", { name: "Simulate consequences" }).click();
  await expect(status(page)).toHaveText("Pending approval");
  await expect(page.getByLabel("Acting user")).toHaveValue("ops-ravi");
  await expect(page.getByTestId("persona-notice")).toContainText("Proposed as Ravi");
  await expect(page.getByTestId("requested-by")).toContainText("Ravi Kumar");
  await expect(page.getByTestId("persona-guide")).toContainText("Approval requires an authorized approver");

  await page.getByRole("button", { name: /Act as Asha Menon/ }).click();
  await page.getByRole("button", { name: "Approve & Execute" }).click();
  await expect(status(page)).toHaveText("Executed");
  await expect(page.getByTestId("now-Order total")).toHaveText("₹72,000.00"); // = the simulated "after"

  // Still acting as Asha: the replay is proposed by Ravi again, so Asha can approve it again.
  await page.getByRole("button", { name: "Reset demo data & run this again" }).click();
  await expect(status(page)).toHaveText("Pending approval");
  await expect(page.getByLabel("Acting user")).toHaveValue("ops-ravi");
  await page.getByRole("button", { name: /Act as Asha Menon/ }).click();
  await page.getByRole("button", { name: "Approve & Execute" }).click();
  await expect(status(page)).toHaveText("Executed");
});

test("self-approval: Asha's own request cannot be approved by Asha; one click proposes it again as Ravi", async ({ page, request }) => {
  await page.goto("/simulate");
  await actAs(page, "approver-asha");
  await page.getByText("Write your own action").click();
  await page.getByLabel("Instruction").fill(FLAGSHIP_TEXT);
  await page.getByRole("button", { name: "Simulate", exact: true }).click();
  await expect(status(page)).toHaveText("Pending approval");
  await expect(page.getByTestId("requested-by")).toContainText("Asha Menon");
  await expect(page.getByTestId("persona-guide")).toContainText("you cannot approve it yourself");
  await expect(page.getByRole("button", { name: "Approve & Execute" })).toHaveCount(0);

  // The backend rule is untouched: Asha approving her own request is refused.
  const ownId = new URL(page.url()).searchParams.get("action") ?? "";
  const refused = await request.post(`${BACKEND}/api/actions/${ownId}/approve`, { headers: { "X-User-Id": "approver-asha" } });
  expect(refused.status()).toBe(403);
  expect(((await refused.json()) as { error: { code: string } }).error.code).toBe("SELF_APPROVAL_FORBIDDEN");

  await page.getByTestId("propose-as-requester").click();
  await expect(page.getByLabel("Acting user")).toHaveValue("ops-ravi");
  await expect(page.getByTestId("requested-by")).toContainText("Ravi Kumar");
  await page.getByRole("button", { name: /Act as Asha Menon/ }).click();
  await page.getByRole("button", { name: "Approve & Execute" }).click();
  await expect(status(page)).toHaveText("Executed");

  const actionId = new URL(page.url()).searchParams.get("action") ?? "";
  await page.getByRole("link", { name: "View the audit trail →" }).click();
  const rows = page.locator("tbody tr", { hasText: actionId.slice(0, 8) });
  for (const event of ["ACTION_PARSED", "APPROVED", "EXECUTED"]) {
    await expect(rows.filter({ hasText: event }).first()).toBeVisible();
  }
});

test("replay: after Approve & Execute on the flagship, one click resets the demo and runs it again", async ({ page }) => {
  await page.goto("/simulate");
  await page.getByRole("button", { name: "Simulate consequences" }).click();
  await expect(status(page)).toHaveText("Pending approval");
  await actAs(page, "approver-asha");
  await page.getByRole("button", { name: "Approve & Execute" }).click();
  await expect(status(page)).toHaveText("Executed");
  await expect(page.getByRole("list", { name: "Execution steps" })).toContainText("CRM case created");
  const firstUrl = page.url();
  await page.getByRole("button", { name: "Reset demo data & run this again" }).click();
  await expect(page).not.toHaveURL(firstUrl);
  await expect(status(page)).toHaveText("Pending approval");
  await expect(page.getByTestId("blast-headline")).toContainText("Exposure₹72,000");
});

test("clarification: 'Refund John's order' asks which John, then which order", async ({ page }) => {
  await page.goto("/simulate");
  await page.getByText("Write your own action").click();
  await page.getByRole("textbox", { name: "Instruction" }).fill("Refund John's order");
  await page.getByRole("button", { name: "Simulate", exact: true }).click();
  const prompt = page.getByRole("region", { name: "Clarification needed" });
  await expect(prompt).toContainText("3 customers match 'John'");
  await prompt.getByRole("button", { name: /John Mathew/ }).click();
  await expect(prompt).toContainText("John Mathew has 3 orders");
  await prompt.getByRole("button", { name: /ORD-10482/ }).click();
  await expect(status(page)).toHaveText("Pending approval");
  await expect(page.getByTestId("risk-score")).toBeVisible();
});

test("escape room: every attack is caught", async ({ page }) => {
  await page.goto("/escape-room");
  for (const id of ["poisoned-instruction", "unauthorized-downstream", "state-tampering", "conflicting-instructions"]) {
    const card = page.getByTestId(`scenario-${id}`);
    await card.getByRole("button", { name: "Run attack" }).click();
    await expect(card.getByText("✓ Caught")).toBeVisible();
  }
});
