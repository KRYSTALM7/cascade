import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionDetail } from "../api/types";
import blocked from "../test/fixtures/blocked.json";
import approved from "../test/fixtures/hero-approved.json";
import hidden from "../test/fixtures/hidden.json";
import executed from "../test/fixtures/hidden-executed.json";
import { jsonResponse, renderWithProviders } from "../test/render";
import { Execution } from "./Execution";
import { FlowStepper } from "./FlowStepper";
import { TechnicalDetails } from "./TechnicalDetails";

afterEach(() => vi.unstubAllGlobals());

const as = (x: unknown) => x as ActionDetail;
const ORDER = {
  id: "ORD-10550",
  status: "CONFIRMED",
  total_amount: "144000.00",
  version: 1,
  customer: { id: "CUST-1006", name: "Ananya Iyer", tier: "STANDARD", status: "ACTIVE" },
  items: [],
  payments: [{ id: "PAY-90550", amount: "144000.00", refunded_amount: "0.00", method: "CARD", status: "CAPTURED" }],
};

describe("FlowStepper", () => {
  const state = (label: string) => screen.getByTestId(`flow-${label}`).getAttribute("data-state");

  it("shows a pending approval as the current step and execution as not yet run", () => {
    renderWithProviders(<FlowStepper detail={as(hidden)} />);
    expect(screen.getByRole("navigation", { name: "Progress" })).toBeInTheDocument();
    for (const label of ["Proposed", "Simulation", "Blast radius", "Consequences", "Risk & decision"]) expect(state(label)).toBe("done");
    expect(state("Approval")).toBe("current");
    expect(state("Execution")).toBe("pending");
  });

  it("moves on once approved and stops at a block", () => {
    const { unmount } = renderWithProviders(<FlowStepper detail={as(approved)} />);
    expect(state("Approval")).toBe("done");
    expect(state("Execution")).toBe("current");
    unmount();
    renderWithProviders(<FlowStepper detail={as(blocked)} />);
    expect(state("Risk & decision")).toBe("stopped");
    expect(state("Approval")).toBe("stopped");
    expect(state("Execution")).toBe("skipped");
  });
});

describe("Execution", () => {
  it("says nothing has run before a decision", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, ORDER)));
    renderWithProviders(<Execution detail={as(hidden)} />);
    expect(screen.getByTestId("nothing-ran")).toHaveTextContent("Nothing has run yet. Cascade has only simulated");
    expect(screen.queryByRole("button", { name: /Reset/ })).not.toBeInTheDocument();
  });

  it("lists what ran in plain words and offers a clean replay", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, ORDER));
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<Execution detail={as(executed)} />);
    const steps = screen.getByRole("list", { name: "Execution steps" });
    for (const text of ["✓Order updated", "✓Inventory released to stock", "✓Refund issued", "✓Customer notified", "✓CRM case created"]) {
      expect(steps).toHaveTextContent(text);
    }
    expect(steps).toHaveTextContent("Finance agent");
    await userEvent.click(screen.getByRole("button", { name: "Reset & run this again" }));
    expect(fetchMock.mock.calls.map(([u]) => u)).toContain("/api/demo/reset");
  });
});

describe("TechnicalDetails", () => {
  it("keeps rules, weights, codes and fingerprints behind one disclosure", async () => {
    renderWithProviders(<TechnicalDetails detail={as(hidden)} />);
    const details = screen.getByTestId("technical-details");
    expect(details).not.toHaveAttribute("open");
    await userEvent.click(within(details).getByText("Technical details"));
    expect(details).toHaveAttribute("open");
    expect(screen.getByTestId("chain-n2")).toHaveTextContent("finance.refund_on_downsize@1");
    expect(screen.getAllByRole("meter")).toHaveLength(5);
    expect(screen.getByRole("list", { name: "Decision reasons" })).toHaveTextContent("REFUND_ABOVE_AUTO_LIMIT");
    expect(details).toHaveTextContent(as(hidden).report!.fingerprint);
    expect(details).toHaveTextContent('"order_id":"ORD-10550"');
  });
});
