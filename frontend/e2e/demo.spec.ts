import { expect, request, test, type Page, type Request as PlaywrightRequest } from "@playwright/test";

/** Local, deterministic browser checks for the six documented demo scenarios. */
const BACKEND = process.env.E2E_BACKEND_URL ?? "http://localhost:8000";
const FLAGSHIP = "Change the laptop quantity to 1 on ORD-10550, customer only needs one";

test.beforeAll(async () => {
  // One reset/seed against the disposable local test database. The browser flows below only
  // simulate or compare; they never approve or execute business actions.
  const api = await request.newContext({ baseURL: BACKEND });
  try {
    const reset = await api.post("/api/demo/reset");
    expect(reset.ok(), "local backend must permit demo reset on the isolated test database").toBeTruthy();
  } finally {
    await api.dispose();
  }
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("cascade.user", "ops-ravi"));
});

const status = (page: Page) => page.getByTestId("action-status");

function captureApiTimings(page: Page) {
  const timings: { path: string; ms: number }[] = [];
  const started = new Map<PlaywrightRequest, number>();
  const relevant = (request: PlaywrightRequest) => /\/api\/(actions\/(parse|simulate)|actions\/[^/]+\/what-if)$/.test(new URL(request.url()).pathname);
  page.on("request", (request) => { if (relevant(request)) started.set(request, Date.now()); });
  page.on("requestfinished", (request) => {
    const start = started.get(request);
    if (start !== undefined) timings.push({ path: new URL(request.url()).pathname, ms: Date.now() - start });
  });
  return timings;
}

async function enterSimulation(page: Page, label: string, phrase: string) {
  const landingScenarios = ["Trim a laptop order", "Cancel a VIP order", "Add a second watch", "Send a shipping SMS"];
  if (landingScenarios.includes(label)) {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Know the consequences");
    await page.getByRole("button", { name: label, exact: true }).click();
    await page.getByRole("button", { name: "Simulate consequences" }).click();
  } else {
    // The two remaining documented scenarios are not landing shortcuts; use the registered form route.
    await page.goto("/simulate");
    await page.getByLabel("What should the agent do?").fill(phrase);
    await page.getByRole("button", { name: "Simulate consequences" }).click();
  }
  await expect(page).toHaveURL(/\/simulate\?action=/);
}

async function expectMetrics(page: Page, expected: { agents: string; actions: string; exposure: string; risk: string; decision: string }) {
  const headline = page.getByTestId("blast-headline");
  await expect(headline).toContainText(expected.agents);
  await expect(headline).toContainText(expected.actions);
  await expect(headline).toContainText(expected.exposure);
  await expect(headline).toContainText(expected.risk);
  await expect(headline).toContainText(expected.decision);
}

test("landing scenario: trim laptop order reveals downstream refund and approval gate", async ({ page }) => {
  const timings = captureApiTimings(page);
  await enterSimulation(page, "Trim a laptop order", FLAGSHIP);
  await expect(status(page)).toHaveText("Pending approval");
  await expectMetrics(page, { agents: "3", actions: "5", exposure: "72,000", risk: "HIGH · 68", decision: "APPROVAL REQUIRED" });
  await expect(page.getByTestId("root-authorization")).toContainText("Authorized");
  await expect(page.getByTestId("graph-node-n2")).toContainText("reacted");
  await expect(page.getByTestId("nothing-ran")).toBeVisible();
  await expect.poll(() => timings.length).toBeGreaterThanOrEqual(2);
  console.log(`[rules-browser] ${JSON.stringify(timings)}`);
  expect(timings.every((item) => item.ms < 30_000)).toBeTruthy();
  expect(timings.reduce((total, item) => total + item.ms, 0)).toBeLessThan(5_000);
});

test("landing scenario: VIP cancellation is high risk and needs approval", async ({ page }) => {
  await enterSimulation(page, "Cancel a VIP order", "Cancel ORD-10482, customer wants out");
  await expect(status(page)).toHaveText("Pending approval");
  await expectMetrics(page, { agents: "3", actions: "5", exposure: "84,500", risk: "HIGH · 76", decision: "APPROVAL REQUIRED" });
  await expect(page.getByTestId("risk-score")).toHaveText("76");
  await expect(page.getByTestId("nothing-ran")).toBeVisible();
});

test("landing scenario: add a second watch is low risk and auto-approved", async ({ page }) => {
  await enterSimulation(page, "Add a second watch", "Change the watch quantity to 2 on ORD-10495");
  await expect(status(page)).toHaveText("Auto approved");
  await expectMetrics(page, { agents: "2", actions: "3", exposure: "₹0", risk: "LOW · 34", decision: "AUTO-APPROVED" });
  await expect(page.getByTestId("nothing-ran")).toBeVisible();
});

test("landing scenario: shipping SMS affects no downstream agents", async ({ page }) => {
  await enterSimulation(page, "Send a shipping SMS", "Send CUST-1005 an SMS that ORD-10501 has shipped");
  await expect(status(page)).toHaveText("Auto approved");
  await expectMetrics(page, { agents: "0", actions: "0", exposure: "₹0", risk: "LOW · 30", decision: "AUTO-APPROVED" });
});

test("documented scenario: support refund is blocked by authorization", async ({ page }) => {
  await enterSimulation(page, "Support issues a refund", "Issue a refund for ORD-10482");
  await expect(status(page)).toHaveText("Blocked");
  await expect(page.getByTestId("graph-node-n0")).toContainText("TOOL_NOT_PERMITTED");
  await expect(page.getByTestId("decision-banner")).toContainText("BLOCKED");
  await expect(page.getByRole("button", { name: /Approve/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Execute" })).toHaveCount(0);
});

test("documented scenario: small order cancellation is low exposure and auto-approved", async ({ page }) => {
  await enterSimulation(page, "Cancel a small order", "Cancel ORD-10510");
  await expect(status(page)).toHaveText("Auto approved");
  await expectMetrics(page, { agents: "3", actions: "3", exposure: "1,998", risk: "MEDIUM · 54", decision: "AUTO-APPROVED" });
});

async function comparePreset(page: Page, scenario: string, phrase: string) {
  await enterSimulation(page, scenario, phrase);
  await expect(status(page)).toHaveText("Pending approval");
  const panel = page.getByRole("region", { name: "What if" });
  await panel.getByRole("button", { name: "Compare this alternative" }).click();
  await expect(page.getByTestId("what-if-result")).toBeVisible();
  return panel;
}

test("what-if example: 20% compensation compares VIP cancellation with computed outcomes", async ({ page }) => {
  const timings = captureApiTimings(page);
  const panel = await comparePreset(page, "Cancel a VIP order", "Cancel ORD-10482, customer wants out");
  await expect.poll(() => timings.some((timing) => timing.path.endsWith("/what-if"))).toBeTruthy();
  expect(timings.every((timing) => timing.ms < 30_000)).toBeTruthy();
  console.log(`[rules-what-if-browser] ${JSON.stringify(timings)}`);
  await expect(page.getByTestId("what-if-compared-text")).toContainText("What if we give 20% compensation instead?");
  const table = panel.getByRole("table");
  await expect(table.getByRole("columnheader", { name: /Proposed action/ })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: /Alternative/ })).toBeVisible();
  await expect(table.getByRole("row", { name: /Exposure/ })).toContainText("84,500");
  await expect(table.getByRole("row", { name: /Exposure/ })).toContainText("16,900");
  await expect(table.getByRole("row", { name: /Downstream actions/ })).toContainText("5");
  await expect(table.getByRole("row", { name: /Downstream actions/ })).toContainText("1");
  await expect(table.getByRole("row", { name: /Risk/ })).toContainText("HIGH · 76/100");
  await expect(table.getByRole("row", { name: /Risk/ })).toContainText("MEDIUM · 53/100");
  await expect(table.getByRole("row", { name: /Agents affected/ })).toContainText("3");
  await expect(table.getByRole("row", { name: /Agents affected/ })).toContainText("1");
  await expect(table.getByRole("row", { name: /Decision/ })).toContainText("Approval required");
  await expect(table.getByRole("row", { name: /Reversibility/ })).toContainText("Irreversible");
});

test("what-if example: 10% compensation shows lower exposure, risk and downstream actions; table stays readable responsively", async ({ page }) => {
  const timings = captureApiTimings(page);
  const panel = await comparePreset(page, "Trim a laptop order", FLAGSHIP);
  await expect.poll(() => timings.some((timing) => timing.path.endsWith("/what-if"))).toBeTruthy();
  expect(timings.every((timing) => timing.ms < 30_000)).toBeTruthy();
  console.log(`[rules-what-if-browser] ${JSON.stringify(timings)}`);
  await expect(page.getByTestId("what-if-compared-text")).toContainText("What if we keep the order and give 10% compensation instead?");
  await expect(page.getByTestId("what-if-summary")).toContainText("14,400 exposure · 1 downstream action · MEDIUM risk");
  await expect(page.getByTestId("what-if-verdict")).toContainText("57,600 less exposure");
  await expect(page.getByTestId("what-if-verdict")).toContainText("4 fewer downstream actions");
  const table = panel.getByRole("table");
  await expect(table.getByRole("columnheader", { name: /Proposed action/ })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: /Alternative/ })).toBeVisible();
  await expect(table.getByRole("row", { name: /Exposure/ })).toContainText("72,000");
  await expect(table.getByRole("row", { name: /Exposure/ })).toContainText("14,400");
  await expect(table.getByRole("row", { name: /Downstream actions/ })).toContainText("5");
  await expect(table.getByRole("row", { name: /Downstream actions/ })).toContainText("1");
  await expect(table.getByRole("row", { name: /Agents affected/ })).toContainText("3");
  await expect(table.getByRole("row", { name: /Agents affected/ })).toContainText("1");
  await expect(table.getByRole("row", { name: /Risk/ })).toContainText("HIGH · 68/100");
  await expect(table.getByRole("row", { name: /Risk/ })).toContainText("MEDIUM · 52/100");
  await expect(table.getByRole("row", { name: /Decision/ })).toContainText("Approval required");
  await expect(table.getByRole("row", { name: /Reversibility/ })).toContainText("Irreversible");

  await page.screenshot({ path: "test-results/what-if-desktop.png", fullPage: true });
  const desktopContrast = await table.evaluate(inspectContrast);
  expect(desktopContrast.every((sample) => sample.ratio >= 4.5), JSON.stringify(desktopContrast)).toBeTruthy();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(table).toBeVisible();
  await expect(table.getByRole("row", { name: /Reversibility/ })).toContainText("Irreversible");
  await expect(table.getByRole("row", { name: /Downstream actions/ })).toContainText("1");
  await page.screenshot({ path: "test-results/what-if-mobile.png", fullPage: true });
  const mobile = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, page: document.documentElement.scrollWidth }));
  expect(mobile.page).toBeLessThanOrEqual(mobile.viewport + 1);
  const mobileContrast = await table.evaluate(inspectContrast);
  expect(mobileContrast.every((sample) => sample.ratio >= 4.5), JSON.stringify(mobileContrast)).toBeTruthy();
});

/** WCAG contrast for visible labels and values against their nearest opaque ancestor background. */
function inspectContrast(tableEl: HTMLElement) {
  const rgb = (value: string) => value.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
  const luminance = (value: string) => {
    const channels = rgb(value).map((part) => part / 255).map((part) => part <= 0.04045 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4);
    return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
  };
  return [...tableEl.querySelectorAll<HTMLElement>("th, td, th *, td *")]
    .filter((element) => element.innerText.trim().length > 0)
    .map((element) => {
      const color = getComputedStyle(element).color;
      let background = "rgb(255, 255, 255)";
      for (let node: HTMLElement | null = element; node; node = node.parentElement) {
        const candidate = getComputedStyle(node).backgroundColor;
        if (!candidate.includes("rgba(0, 0, 0, 0)") && !candidate.includes("rgba(0,0,0,0)")) {
          background = candidate;
          break;
        }
      }
      const a = luminance(color), b = luminance(background);
      return { text: element.innerText, color, background, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
    });
}

test("ambiguous and unsupported requests ask for clarification without simulating an action", async ({ page }) => {
  await page.goto("/simulate");
  const input = page.getByLabel("What should the agent do?");
  await input.fill("Cancel the order");
  await page.getByRole("button", { name: "Simulate consequences" }).click();
  await expect(page).toHaveURL(/\/simulate\?action=/);
  await expect(page.getByRole("region", { name: "Clarification needed" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Blast radius" })).toHaveCount(0);

  await page.getByRole("link", { name: /New simulation/ }).click();
  await input.fill("Please make the customer happy");
  await page.getByRole("button", { name: "Simulate consequences" }).click();
  await expect(page.getByRole("region", { name: "Clarification needed" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Blast radius" })).toHaveCount(0);
});
