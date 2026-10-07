import { describe, expect, it } from "vitest";
import { inr, statusLabel } from "./format";

describe("inr", () => {
  it.each([
    ["84500.00", "₹84,500.00"],
    ["1998.00", "₹1,998.00"],
    ["0.00", "₹0.00"],
    ["-67600.00", "−₹67,600.00"],
    ["1000000.5", "₹1,000,000.50"],
  ])("formats %s as %s without re-computing the value", (raw, expected) => {
    expect(inr(raw)).toBe(expected);
  });

  it("shows a dash for missing amounts", () => {
    expect(inr(null)).toBe("—");
  });
});

describe("statusLabel", () => {
  it("humanises enum values", () => {
    expect(statusLabel("PENDING_APPROVAL")).toBe("Pending approval");
  });
});
