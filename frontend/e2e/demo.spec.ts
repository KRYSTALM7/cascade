import { expect, test, type Page } from "@playwright/test";

/** The judge's path through Cascade, end to end, with the offline rules provider. */

test.beforeEach(async ({ request, page }) => {
  const reset = await request.post("http://localhost:8000/api/demo/reset");
  expect(reset.ok(), "backend must run with DEMO_MODE=true").toBeTruthy();
  await page.addInitScript(() => window.localStorage.setItem("cascade.user", "ops-ravi"));
});

async function actAs(page: Page, userId: string) {
  await page.getByLabel("Acting user").selectOption(userId);
}

const status = (page: Page) => page.getByTestId("action-status");

test("hero: NL cancel → graph → approval → approve → execute → order cancelled → audit", async ({ page }) => {
  await page.goto("/simulate");
  await page.getByRole("button", { name: "High scenario" }).click();

  // Parsed + simulated: the whole cascade is visible before anything runs.
  await expect(status(page)).toHaveText("Pending approval");
  await expect(page).toHaveURL(/\/simulate\?action=/);
  for (const id of ["n0", "n1", "n2", "n3", "n4", "n5"]) {
    await expect(page.getByTestId(`graph-node-${id}`)).toBeVisible();
  }
  await expect(page.getByTestId("graph-node-n1").getByTestId("money-badge")).toHaveText("−₹84,500.00");
  await expect(page.getByTestId("risk-score")).toHaveText("76");
  await expect(page.getByRole("region", { name: "Blast radius" })).toContainText("₹84,500.00");
  await expect(page.getByRole("list", { name: "Decision reasons" })).toContainText("REFUND_ABOVE_AUTO_LIMIT");
  await expect(page.getByRole("region", { name: "Explanation" })).toContainText("human approver must decide");
  await expect(page.getByTestId("now-Order status")).toHaveText("CONFIRMED");

  // The operator cannot approve; Asha can.
  await expect(page.getByRole("button", { name: "Approve as ops-ravi" })).toBeVisible();
  await actAs(page, "approver-asha");
  await page.getByRole("button", { name: "Approve as approver-asha" }).click();
  await expect(status(page)).toHaveText("Approved");

  await actAs(page, "ops-ravi");
  await page.getByRole("button", { name: "Execute" }).click();
  await expect(status(page)).toHaveText("Executed");
  await expect(page.getByTestId("now-Order status")).toHaveText("CANCELLED");

  const actionId = new URL(page.url()).searchParams.get("action");
  await page.getByRole("link", { name: "Audit" }).click();
  const rows = page.locator("tbody tr", { hasText: actionId?.slice(0, 8) ?? "" });
  for (const event of ["ACTION_PARSED", "DECISION_MADE", "APPROVED", "EXECUTED"]) {
    await expect(rows.filter({ hasText: event }).first()).toBeVisible();
  }
});

test("a low-limit approver is refused with the backend's reason", async ({ page }) => {
  await page.goto("/simulate");
  await page.getByRole("button", { name: "High scenario" }).click();
  await expect(status(page)).toHaveText("Pending approval");
  await actAs(page, "approver-dev");
  await page.getByRole("button", { name: "Approve as approver-dev" }).click();
  await expect(page.getByRole("alert")).toContainText("APPROVAL_LIMIT_EXCEEDED");
  await expect(status(page)).toHaveText("Pending approval");
});

test("unauthorized: support cannot issue a refund — blocked, nothing to approve", async ({ page }) => {
  await page.goto("/simulate");
  await page.getByRole("button", { name: "Unauthorized scenario" }).click();
  await expect(status(page)).toHaveText("Blocked");
  const root = page.getByTestId("graph-node-n0");
  await expect(root).toHaveAttribute("data-status", "BLOCKED");
  await expect(root).toContainText("TOOL_NOT_PERMITTED");
  await expect(page.getByRole("button", { name: /Approve as/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Execute" })).toHaveCount(0);
});

test("auto-approve: the ₹1,998 cancel runs without a human", async ({ page }) => {
  await page.goto("/simulate");
  await page.getByRole("button", { name: "Auto-approve scenario" }).click();
  await expect(status(page)).toHaveText("Auto approved");
  await page.getByRole("button", { name: "Execute" }).click();
  await expect(status(page)).toHaveText("Executed");
});

test("what-if: 20% compensation instead of cancelling is lower risk", async ({ page }) => {
  await page.goto("/simulate");
  await page.getByRole("button", { name: "High scenario" }).click();
  await expect(status(page)).toHaveText("Pending approval");
  await page.getByRole("textbox", { name: "Alternative" }).fill("What if we give 20% compensation instead?");
  await page.getByRole("button", { name: "Compare" }).click();
  const result = page.getByTestId("what-if-result");
  await expect(result).toContainText("₹16,900.00");
  await expect(result).toContainText("₹84,500.00");
  await expect(result.getByRole("region", { name: "Explanation" })).toContainText("lower risk");
  await result.getByRole("link", { name: "Open the alternative →" }).click();
  await expect(page.getByRole("heading", { level: 2 })).toContainText("issue compensation");
});

test("clarification: 'Refund John's order' asks which John, then which order", async ({ page }) => {
  await page.goto("/simulate");
  await page.getByRole("textbox", { name: "Instruction" }).fill("Refund John's order");
  await page.getByRole("button", { name: "Simulate" }).click();
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
