import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import hidden from "../test/fixtures/hidden.json";
import { jsonResponse, renderWithProviders } from "../test/render";
import { SimulatePage } from "./SimulatePage";

afterEach(() => vi.unstubAllGlobals());

const parsed = { ...hidden, action: { ...hidden.action, status: "PARSED" }, report: null, risk: null, decision: null };

describe("SimulatePage landing", () => {
  it("shows simulation input form", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, [])));
    renderWithProviders(<SimulatePage />, { route: "/simulate" });
    expect(screen.getByRole("heading", { level: 1, name: "Simulate an action" })).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Cancel ORD-10482/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Simulate consequences" })).toBeInTheDocument();
  });

  it("one click simulates an action with seeded data", async () => {
    const order = { id: "ORD-10550", status: "CONFIRMED", total_amount: "144000.00", version: 1, customer: { id: "CUST-1006", name: "A", tier: "STANDARD", status: "ACTIVE" }, items: [], payments: [] };
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(
        jsonResponse(200, url === "/api/actions/parse" ? parsed : url === "/api/actions/simulate" ? hidden : url.startsWith("/api/orders/") ? order : []),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<SimulatePage />, { route: "/simulate" });

    // Fill in the form
    const input = screen.getByPlaceholderText(/Cancel ORD-10482/i);
    await userEvent.clear(input);
    await userEvent.type(input, "Change the laptop quantity to 1 on ORD-10550, customer only needs one");
    await userEvent.click(screen.getByRole("button", { name: "Simulate consequences" }));

    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    const parse = calls.find(([u]) => u === "/api/actions/parse")!;
    expect(JSON.parse(String(parse[1].body))).toEqual({
      agent_id: "customer-support",
      text: "Change the laptop quantity to 1 on ORD-10550, customer only needs one",
    });
    // Result should load
    const headline = await screen.findByTestId("blast-headline", undefined, { timeout: 8000 });
    expect(headline).toHaveTextContent("₹72,000");
    expect(headline).toHaveTextContent("Exposure");
  });

  it("shows a parser failure clearly and does not start a simulation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(422, {
      error: {
        code: "LLM_OUTPUT_INVALID",
        message: "The request could not be interpreted safely. Rephrase it or use the structured form.",
        details: { reason: "Unsupported tool output." },
        request_id: "parse-req-1",
      },
    }));
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<SimulatePage />, { route: "/simulate" });

    await userEvent.type(screen.getByPlaceholderText(/Cancel ORD-10482/i), "Cancel ORD-10482");
    await userEvent.click(screen.getByRole("button", { name: "Simulate consequences" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("LLM_OUTPUT_INVALID");
    expect(alert).toHaveTextContent("Rephrase it or use the structured form");
    expect(alert).toHaveTextContent("Unsupported tool output");
    expect(alert).toHaveTextContent("Request ID: parse-req-1");
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["/api/actions/parse"]);
    expect(screen.queryByTestId("blast-headline")).not.toBeInTheDocument();
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
    await userEvent.click(screen.getByRole("button", { name: "Reset & run again" }));
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
