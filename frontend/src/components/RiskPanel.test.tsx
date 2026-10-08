import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ActionDetail } from "../api/types";
import blocked from "../test/fixtures/blocked.json";
import hero from "../test/fixtures/hero.json";
import { RiskDetails, RiskPanel } from "./RiskPanel";

const detail = hero as unknown as ActionDetail;

describe("RiskPanel (risk & policy decision)", () => {
  it("leads with the level, the score and an unmissable decision", () => {
    render(<RiskPanel risk={detail.risk!} reasons={detail.decision!.reasons} decision={detail.decision!.decision} />);
    expect(screen.getByText("HIGH RISK")).toBeInTheDocument();
    expect(screen.getByTestId("risk-score")).toHaveTextContent("76");
    expect(screen.getByTestId("decision-banner")).toHaveTextContent("APPROVAL REQUIRED");
    // No weights or meters on the main path.
    expect(screen.queryAllByRole("meter")).toHaveLength(0);
  });

  it("shows the backend's top reasons, most decisive first, without codes", () => {
    render(<RiskPanel risk={detail.risk!} reasons={detail.decision!.reasons} decision={detail.decision!.decision} />);
    const items = within(screen.getByRole("list", { name: "Top reasons" })).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("₹84,500.00 would leave NovaCart, above the ₹2,000.00 auto-approve limit.");
    expect(items[1]).toHaveTextContent("Risk is HIGH (76/100).");
    expect(screen.getByRole("list", { name: "Top reasons" })).not.toHaveTextContent("REFUND_ABOVE_AUTO_LIMIT");
  });

  it("says BLOCKED for a blocked action", () => {
    const b = blocked as unknown as ActionDetail;
    render(<RiskPanel risk={b.risk!} reasons={b.decision!.reasons} decision={b.decision!.decision} />);
    expect(screen.getByTestId("decision-banner")).toHaveTextContent("BLOCKED");
    expect(screen.getByRole("list", { name: "Top reasons" })).toHaveTextContent("Agent customer-support is not permitted to call issue_refund.");
  });
});

describe("RiskDetails (technical)", () => {
  it("shows all five dimensions as weighted bars", () => {
    render(<RiskDetails risk={detail.risk!} reasons={detail.decision!.reasons} />);
    const meters = screen.getAllByRole("meter");
    expect(meters.map((m) => m.getAttribute("aria-label"))).toEqual([
      "Financial",
      "Irreversibility",
      "Downstream agents",
      "Customer impact",
      "Data sensitivity",
    ]);
    expect(meters[0]).toHaveAttribute("aria-valuenow", "93.8");
    expect(within(screen.getByTestId("dimension-downstream")).getByText("3 other agents act: crm, finance, inventory.")).toBeInTheDocument();
  });

  it("lists every reason in a plain sentence with its stable code", () => {
    render(<RiskDetails risk={detail.risk!} reasons={detail.decision!.reasons} />);
    const reasons = screen.getByRole("list", { name: "Decision reasons" });
    expect(reasons).toHaveTextContent("₹84,500.00 would leave NovaCart, above the ₹2,000.00 auto-approve limit.");
    expect(reasons).toHaveTextContent("REFUND_ABOVE_AUTO_LIMIT");
    expect(reasons).toHaveTextContent("Risk is HIGH (76/100).");
    expect(within(reasons).getAllByRole("listitem")).toHaveLength(3);
  });
});
