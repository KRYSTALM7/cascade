import { describe, expect, it } from "vitest";
import type { ActionDetail, GraphEdge } from "../api/types";
import hero from "../test/fixtures/hero.json";
import { NODE_WIDTH, edgeLabel, fitViewport, layoutBounds, layoutGraph, nodeMoneyOut } from "./layout";

const report = (hero as unknown as ActionDetail).report!;

describe("layoutGraph", () => {
  it("lays the cascade out left to right by depth", () => {
    const positioned = layoutGraph(report.nodes, report.edges);
    const x = Object.fromEntries(positioned.map((p) => [p.node.id, p.x]));
    expect(x.n0).toBeLessThan(x.n1!);
    expect(x.n1).toBe(x.n2);
    expect(x.n1! + NODE_WIDTH).toBeLessThan(x.n4!);
  });

  it("is deterministic", () => {
    expect(layoutGraph(report.nodes, report.edges)).toEqual(layoutGraph(report.nodes, report.edges));
  });

  it("fits the whole graph into the pane without zooming past 110%", () => {
    const bounds = layoutBounds(layoutGraph(report.nodes, report.edges));
    const vp = fitViewport(bounds, 960, 400);
    expect(bounds.height * vp.zoom).toBeLessThanOrEqual(400);
    expect(bounds.width * vp.zoom).toBeLessThanOrEqual(960);
    expect(fitViewport(bounds, 5000, 5000).zoom).toBe(1.1);
    expect(fitViewport(bounds, 0, 0)).toEqual({ x: 0, y: 0, zoom: 1 });
  });
});

describe("nodeMoneyOut", () => {
  it("sums outflows exactly in paise and ignores nodes without money", () => {
    const refund = report.nodes.find((n) => n.tool_id === "issue_refund")!;
    expect(nodeMoneyOut(refund)).toBe("84500.00");
    expect(nodeMoneyOut(report.nodes[0]!)).toBeNull();
    const twice = { ...refund, money: [...refund.money, { ...refund.money[0]!, amount: "0.01" }] };
    expect(nodeMoneyOut(twice)).toBe("84500.01");
  });
});

describe("edgeLabel", () => {
  const edge: GraphEdge = { source: "n0", target: "n1", kind: "TRIGGER", event: "ORDER_CANCELLED", rule_id: "r", rule_version: 1 };
  it("shows the trigger event, or what a duplicate/cycle edge means", () => {
    expect(edgeLabel(edge)).toBe("ORDER_CANCELLED");
    expect(edgeLabel({ ...edge, kind: "DUPLICATE" })).toBe("duplicate · runs once");
    expect(edgeLabel({ ...edge, kind: "CYCLE" })).toBe("cycle · cut");
  });
});
