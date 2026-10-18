import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionDetail, WhatIfResult } from "../api/types";
import { SCENARIOS, scenarioFor } from "../lib/scenarios";
import hidden from "../test/fixtures/hidden.json";
import whatIf from "../test/fixtures/whatif-hidden.json";
import { jsonResponse, renderWithProviders } from "../test/render";
import { WhatIfPanel } from "./WhatIfPanel";

afterEach(() => vi.unstubAllGlobals());

// Captured from the real API: trim ORD-10550 vs "keep the order and give 10% compensation".
const result = whatIf as unknown as WhatIfResult;
const detail = hidden as unknown as ActionDetail;

describe("what-if presets", () => {
  it("are scenario-specific, and the flagship's is the 10% alternative (20% stays HIGH on ORD-10550)", () => {
    const flagship = scenarioFor(detail.action.agent_id, detail.action.raw_text);
    expect(flagship?.key).toBe("hidden");
    expect(flagship?.whatIf?.text).toBe("What if we keep the order and give 10% compensation instead?");
    expect(scenarioFor("customer-support", "Cancel ORD-10482, customer wants out")?.whatIf?.text).toBe("What if we give 20% compensation instead?");
    // No generic preset: scenarios without a sensible alternative get none.
    expect(SCENARIOS.filter((s) => !s.whatIf).map((s) => s.key)).toEqual(["add-watch", "shipping-sms", "support-refund", "small-cancel"]);
    expect(scenarioFor("customer-support", "something typed by hand")).toBeUndefined();
  });

  it("sends the preset to the backend and shows a side-by-side, honest comparison", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, result));
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<WhatIfPanel actionId={detail.action.id} baseToolId={detail.action.tool_id} preset={SCENARIOS[0]!.whatIf} />);
    expect(screen.getByRole("heading", { name: "Is there a safer option?" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Compare this alternative" }));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/actions/${detail.action.id}/what-if`);
    expect(JSON.parse(String(init.body))).toEqual({ text: "What if we keep the order and give 10% compensation instead?" });

    // Lower risk on every measured dimension but one — and a different action than requested,
    // fully irreversible, still needing approval: a trade-off, never "Recommended".
    const verdict = await screen.findByTestId("what-if-verdict");
    expect(verdict).toHaveTextContent("Lower-risk alternative");
    expect(screen.getByTestId("what-if-summary")).toHaveTextContent("₹14,400 exposure · 1 downstream action · MEDIUM risk");
    const diffs = within(verdict).getByRole("list", { name: "Differences" });
    for (const text of ["₹57,600 less exposure", "4 fewer downstream actions", "2 fewer agents involved", "Lower risk: HIGH 68 → MEDIUM 52"]) {
      expect(diffs).toHaveTextContent(text);
    }
    const tradeoffs = within(verdict).getByRole("list", { name: "Trade-offs" });
    for (const text of [
      "Trade-off: a different action (Issue compensation instead of modify order) — it does not preserve the originally requested outcome",
      "Irreversible: none of it can be undone",
      "Approval still required",
    ]) {
      expect(tradeoffs).toHaveTextContent(text);
    }
    expect(screen.queryByTestId("recommended")).not.toBeInTheDocument();
    expect(verdict).not.toHaveTextContent("Safer alternative");
    const table = screen.getByRole("table");
    for (const cell of within(table).getAllByRole("cell")) {
      expect(cell).toHaveClass("text-slate-900");
    }
    for (const text of ["Exposure₹72,000.00₹14,400.00", "Downstream actions51", "Agents affected3 — CRM agent, Finance agent, Inventory agent1 — CRM agent", "RiskHIGH · 68/100MEDIUM · 52/100", "DecisionApproval requiredApproval required"]) {
      expect(table).toHaveTextContent(text);
    }
    expect(screen.getByRole("link", { name: "Open the alternative →" })).toHaveAttribute("href", `/simulate?action=${result.alternative.action.id}`);
  });

  it("submits the custom alternative text and labels the results with that exact request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, result));
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<WhatIfPanel actionId={detail.action.id} baseToolId={detail.action.tool_id} />);

    const input = screen.getByRole("textbox", { name: "Alternative" });
    const compareButton = screen.getByRole("button", { name: "Compare" });
    expect(compareButton).toBeDisabled();
    await userEvent.type(input, "Keep the order and give 10% compensation");
    expect(compareButton).toBeEnabled();
    await userEvent.click(compareButton);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ text: "Keep the order and give 10% compensation" });
    expect(await screen.findByTestId("what-if-compared-text")).toHaveTextContent(
      "Comparison for: Keep the order and give 10% compensation",
    );
    expect(screen.getByTestId("what-if-result")).toBeInTheDocument();
  });

  it("clears stale results on failure and lets the user retry", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, result))
      .mockResolvedValueOnce(jsonResponse(422, {
        error: { code: "WHAT_IF_NEEDS_CLARIFICATION", message: "Describe the alternative more precisely.", details: {}, request_id: "req-123" },
      }))
      .mockResolvedValueOnce(jsonResponse(200, result));
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<WhatIfPanel actionId={detail.action.id} preset={SCENARIOS[0]!.whatIf} />);

    await userEvent.click(screen.getByRole("button", { name: "Compare this alternative" }));
    expect(await screen.findByTestId("what-if-result")).toBeInTheDocument();
    const input = screen.getByRole("textbox", { name: "Alternative" });
    await userEvent.type(input, "Ambiguous alternative");
    await userEvent.click(screen.getByRole("button", { name: "Compare" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("WHAT_IF_NEEDS_CLARIFICATION");
    expect(screen.queryByTestId("what-if-result")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Request ID: req-123");

    await userEvent.click(screen.getByRole("button", { name: "Compare" }));
    expect(await screen.findByTestId("what-if-result")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("shows pending state and prevents duplicate comparisons", async () => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<WhatIfPanel actionId={detail.action.id} />);
    const input = screen.getByRole("textbox", { name: "Alternative" });
    await userEvent.type(input, "A safer alternative");
    const button = screen.getByRole("button", { name: "Compare" });
    await userEvent.click(button);

    expect(await screen.findByRole("status")).toHaveTextContent("Comparing this alternative");
    expect(input).toBeDisabled();
    expect(button).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never recommends an alternative that is blocked, even if its risk score is lower", async () => {
    const blockedAlt: WhatIfResult = {
      ...result,
      comparison: { ...result.comparison, alternative: { ...result.comparison.alternative, decision: "BLOCKED" }, lower_risk: true },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, blockedAlt)));
    renderWithProviders(<WhatIfPanel actionId={detail.action.id} />);
    await userEvent.type(screen.getByRole("textbox", { name: "Alternative" }), "anything");
    await userEvent.click(screen.getByRole("button", { name: "Compare" }));
    expect(await screen.findByTestId("what-if-verdict")).toHaveTextContent("Lower risk, but not a better outcome");
    expect(screen.getByTestId("what-if-tradeoffs")).toHaveTextContent("Blocked: it cannot run");
    expect(screen.queryByTestId("recommended")).not.toBeInTheDocument();
  });

  it("recommends only the same action, no less reversible, with no stricter decision", async () => {
    const sameAction: WhatIfResult = {
      ...result,
      comparison: {
        ...result.comparison,
        alternative: { ...result.comparison.alternative, reversibility: "PARTIAL", decision: "APPROVAL_REQUIRED" },
      },
      alternative: { ...result.alternative, action: { ...result.alternative.action, tool_id: "modify_order" } },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, sameAction)));
    renderWithProviders(<WhatIfPanel actionId={detail.action.id} baseToolId="modify_order" />);
    await userEvent.type(screen.getByRole("textbox", { name: "Alternative" }), "anything");
    await userEvent.click(screen.getByRole("button", { name: "Compare" }));
    expect(await screen.findByTestId("what-if-verdict")).toHaveTextContent("Safer alternative");
    expect(screen.getByTestId("recommended")).toBeInTheDocument();
    expect(screen.getByTestId("what-if-tradeoffs")).toHaveTextContent("Approval still required");
    expect(screen.getByTestId("what-if-tradeoffs")).not.toHaveTextContent("Trade-off:");
  });

  it("offers no preset button without a scenario preset", () => {
    renderWithProviders(<WhatIfPanel actionId={detail.action.id} />);
    expect(screen.queryByRole("button", { name: "Compare this alternative" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Compare" })).toBeDisabled();
  });
});
