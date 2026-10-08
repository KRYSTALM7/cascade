import { describe, expect, it } from "vitest";
import { doneText, humanEvent, humanParams, inr, inrShort, statusLabel, topReasons } from "./format";

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

describe("inrShort", () => {
  it.each([
    ["72000.00", "₹72,000"],
    ["16900.50", "₹16,900.50"],
    ["0.00", "₹0"],
  ])("drops only a zero paise part: %s → %s", (raw, expected) => {
    expect(inrShort(raw)).toBe(expected);
  });
});

describe("plain-language labels", () => {
  it("humanises events, keeping unknown ones readable", () => {
    expect(humanEvent("ORDER_MODIFIED")).toBe("Order was modified");
    expect(humanEvent("REFUND_ISSUED")).toBe("Refund was issued");
    expect(humanEvent("SOMETHING_NEW")).toBe("Something new");
    expect(humanEvent(null)).toBe("");
  });

  it("names applied execution steps in the past tense", () => {
    expect(doneText("issue_refund")).toBe("Refund issued");
    expect(doneText("create_customer_case")).toBe("CRM case created");
    expect(doneText("brand_new_tool")).toBe("Brand new tool done");
  });

  it("renders parameters readably", () => {
    expect(humanParams({ lines: [{ sku: "SKU-LAP-001", quantity: 1 }], order_id: "ORD-10550" })).toBe("SKU-LAP-001 → qty 1 · order ORD-10550");
    expect(humanParams({ order_id: "ORD-10482", amount: "84500.00" })).toBe("order ORD-10482 · amount ₹84,500.00");
  });

  it("orders reasons BLOCK → APPROVAL → INFO without changing them", () => {
    const r = (code: string, severity: "BLOCK" | "APPROVAL" | "INFO") => ({ code, severity, message: code, node_id: null, details: {} });
    expect(topReasons([r("i", "INFO"), r("a", "APPROVAL"), r("b", "BLOCK"), r("a2", "APPROVAL")], 3).map((x) => x.code)).toEqual(["b", "a", "a2"]);
  });
});
