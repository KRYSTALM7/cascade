import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ActionDetail } from "../api/types";
import hero from "../test/fixtures/hero.json";
import { RiskPanel } from "./RiskPanel";

const detail = hero as unknown as ActionDetail;

describe("RiskPanel", () => {
  it("shows the score, level and all five dimensions as bars", () => {
    render(<RiskPanel risk={detail.risk!} reasons={detail.decision!.reasons} />);
    expect(screen.getByTestId("risk-score")).toHaveTextContent("76");
    expect(screen.getByText("HIGH")).toBeInTheDocument();
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

  it("explains the decision in plain sentences with stable codes", () => {
    render(<RiskPanel risk={detail.risk!} reasons={detail.decision!.reasons} />);
    const reasons = screen.getByRole("list", { name: "Decision reasons" });
    expect(reasons).toHaveTextContent("₹84,500.00 would leave NovaCart, above the ₹2,000.00 auto-approve limit.");
    expect(reasons).toHaveTextContent("REFUND_ABOVE_AUTO_LIMIT");
    expect(reasons).toHaveTextContent("Risk is HIGH (76/100).");
  });
});
