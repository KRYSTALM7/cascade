import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import hidden from "../test/fixtures/hidden.json";
import { jsonResponse, renderWithProviders } from "../test/render";
import { SimulatePage } from "./SimulatePage";

afterEach(() => vi.unstubAllGlobals());

const parsed = { ...hidden, action: { ...hidden.action, status: "PARSED" }, report: null, risk: null, decision: null };

describe("SimulatePage landing", () => {
  it("leads with the agent's proposal and what Cascade will do with it", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, [])));
    renderWithProviders(<SimulatePage />, { route: "/simulate" });
    expect(screen.getByRole("heading", { level: 1, name: "What happens if this agent acts?" })).toBeInTheDocument();
    const proposal = screen.getByTestId("hero-proposal");
    expect(proposal).toHaveTextContent("Support agent");
    expect(proposal).toHaveTextContent("Modify order ORD-10550");
    expect(proposal).toHaveTextContent("Reduce laptops: 2 → 1");
    expect(screen.getByRole("button", { name: "Simulate consequences" })).toBeInTheDocument();
  });

  it("names scenarios by situation, never by outcome", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, [])));
    renderWithProviders(<SimulatePage />, { route: "/simulate" });
    const names = within(screen.getByRole("region", { name: "Scenarios" }))
      .getAllByRole("button", { name: / scenario$/ })
      .map((b) => b.getAttribute("aria-label"));
    expect(names).toEqual([
      "Trim a laptop order scenario",
      "Cancel a VIP order scenario",
      "Add a second watch scenario",
      "Send a shipping SMS scenario",
      "Support issues a refund scenario",
      "Cancel a small order scenario",
    ]);
    for (const spoiler of ["High", "Medium", "Low", "Unauthorized", "Auto-approve"]) {
      expect(screen.queryByRole("button", { name: `${spoiler} scenario` })).not.toBeInTheDocument();
    }
  });

  it("keeps free text and structured input behind 'Write your own action'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, [])));
    renderWithProviders(<SimulatePage />, { route: "/simulate" });
    const summary = screen.getByText(/Write your own action/);
    const details = summary.closest("details")!;
    expect(details).not.toHaveAttribute("open");
    await userEvent.click(summary);
    expect(details).toHaveAttribute("open");
    expect(within(details).getByRole("textbox", { name: "Instruction" })).toBeInTheDocument();
    expect(within(details).getByRole("tab", { name: "Structured" })).toBeInTheDocument();
  });

  it("one click proposes the flagship action with seeded data and simulates it", async () => {
    const order = { id: "ORD-10550", status: "CONFIRMED", total_amount: "144000.00", version: 1, customer: { id: "CUST-1006", name: "A", tier: "STANDARD", status: "ACTIVE" }, items: [], payments: [] };
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(
        jsonResponse(200, url === "/api/actions/parse" ? parsed : url === "/api/actions/simulate" ? hidden : url.startsWith("/api/orders/") ? order : []),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<SimulatePage />, { route: "/simulate" });
    await userEvent.click(screen.getByRole("button", { name: "Simulate consequences" }));

    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    const parse = calls.find(([u]) => u === "/api/actions/parse")!;
    expect(JSON.parse(String(parse[1].body))).toEqual({
      agent_id: "customer-support",
      text: "Change the laptop quantity to 1 on ORD-10550, customer only needs one",
    });
    const simulate = calls.find(([u]) => u === "/api/actions/simulate")!;
    expect(JSON.parse(String(simulate[1].body))).toEqual({ action_id: hidden.action.id });
    // …and the result opens with the blast radius as the headline.
    // The result page mounts React Flow; under a loaded parallel run that can exceed the 1s default.
    expect(await screen.findByTestId("blast-headline", undefined, { timeout: 8000 })).toHaveTextContent("Exposure₹72,000");
    expect(screen.getByRole("navigation", { name: "Progress" })).toBeInTheDocument();
  });
});

describe("SimulatePage result states", () => {
  const order = { id: "ORD-10550", status: "CONFIRMED", total_amount: "72000.00", version: 2, customer: { id: "CUST-1006", name: "A", tier: "STANDARD", status: "ACTIVE" }, items: [], payments: [] };
  const route = (detail: unknown) => (url: string) =>
    Promise.resolve(jsonResponse(200, url.startsWith("/api/actions/") && !url.endsWith("/simulate") ? detail : url.startsWith("/api/orders/") ? order : url === "/api/actions/simulate" ? hidden : []));

  it("offers a reset-and-replay when the seeded order was already changed by an earlier run (NO_CHANGE)", async () => {
    const root = { ...hidden.report.nodes[0]!, status: "WOULD_FAIL", status_code: "NO_CHANGE", status_message: "Nothing would change." };
    const replayed = {
      ...hidden,
      action: { ...hidden.action, status: "BLOCKED", decision: "BLOCKED" },
      report: { ...hidden.report, nodes: [root], edges: [] },
      decision: { ...hidden.decision, decision: "BLOCKED" },
      approval: null,
    };
    const fetchMock = vi.fn(route(replayed));
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<SimulatePage />, { route: `/simulate?action=${hidden.action.id}` });
    expect(await screen.findByText(/already has this change/, undefined, { timeout: 8000 })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reset demo data & run again" }));
    const urls = fetchMock.mock.calls.map(([u]) => u);
    expect(urls).toContain("/api/demo/reset");
    expect(urls).toContain("/api/actions/parse");
  });

  it("keeps the STALE banner and re-simulates the same action", async () => {
    const stale = { ...hidden, action: { ...hidden.action, status: "STALE" }, approval: null };
    const fetchMock = vi.fn(route(stale));
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<SimulatePage />, { route: `/simulate?action=${hidden.action.id}` });
    expect(await screen.findByText(/changed since this simulation, so nothing was applied/, undefined, { timeout: 8000 })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Approval gate" })).toHaveTextContent("STALE");
    await userEvent.click(screen.getAllByRole("button", { name: "Re-simulate" })[0]!);
    const call = (fetchMock.mock.calls as unknown as [string, RequestInit][]).find(([u]) => u === "/api/actions/simulate")!;
    expect(JSON.parse(String(call[1].body))).toEqual({ action_id: hidden.action.id });
  });
});
