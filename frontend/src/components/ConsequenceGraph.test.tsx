import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ActionDetail } from "../api/types";
import blocked from "../test/fixtures/blocked.json";
import hero from "../test/fixtures/hero.json";
import { BlastRadius } from "./BlastRadius";
import { ConsequenceGraph, GraphLegend } from "./ConsequenceGraph";

const heroDetail = hero as unknown as ActionDetail;
const blockedDetail = blocked as unknown as ActionDetail;

describe("ConsequenceGraph", () => {
  it("renders one node per consequence, coloured by agent, with money on the refund", () => {
    render(<ConsequenceGraph report={heroDetail.report!} />);
    for (const id of ["n0", "n1", "n2", "n3", "n4", "n5"]) {
      expect(screen.getByTestId(`graph-node-${id}`)).toBeInTheDocument();
    }
    const refund = screen.getByTestId("graph-node-n1");
    expect(within(refund).getByText("Finance agent")).toBeInTheDocument();
    expect(within(refund).getByText("Issue refund")).toBeInTheDocument();
    expect(within(refund).getByTestId("money-badge")).toHaveTextContent("−₹84,500.00");
    expect(screen.getAllByTestId("money-badge")).toHaveLength(1);
    expect(within(screen.getByTestId("graph-node-n0")).getByText("Support agent")).toBeInTheDocument();
  });

  it("says who proposed and who reacted, and marks allowed and optional steps", () => {
    render(<ConsequenceGraph report={heroDetail.report!} />);
    expect(within(screen.getByTestId("graph-node-n0")).getByTestId("node-role")).toHaveTextContent("proposed this action");
    const refund = screen.getByTestId("graph-node-n1");
    expect(within(refund).getByTestId("node-role")).toHaveTextContent("reacted & proposed");
    expect(refund).toHaveTextContent("✓ Allowed");
    expect(refund).not.toHaveTextContent("optional");
    expect(screen.getByTestId("graph-node-n3")).toHaveTextContent("optional"); // crm.flag_vip_on_cancel is not required
  });

  it("keeps rule ids and raw events off the node face but in its tooltip", () => {
    render(<ConsequenceGraph report={heroDetail.report!} />);
    const refund = screen.getByTestId("graph-node-n1");
    expect(refund).not.toHaveTextContent("finance.refund_on_cancel@1");
    expect(refund.getAttribute("title")).toContain("Rule: finance.refund_on_cancel@1");
    expect(refund.getAttribute("title")).toContain("Event: ORDER_CANCELLED");
  });

  it("styles a blocked node and names the reason", () => {
    render(<ConsequenceGraph report={blockedDetail.report!} />);
    const node = screen.getByTestId("graph-node-n0");
    expect(node).toHaveAttribute("data-status", "BLOCKED");
    expect(within(node).getByText("BLOCKED")).toBeInTheDocument();
    expect(within(node).getByText("TOOL_NOT_PERMITTED")).toBeInTheDocument();
    expect(node).not.toHaveTextContent("✓ Allowed");
  });

  it("lists every step for assistive technology", () => {
    render(<ConsequenceGraph report={heroDetail.report!} />);
    const list = screen.getByRole("list", { name: "Consequence steps" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(6);
  });
});

describe("GraphLegend", () => {
  it("explains every visual distinction", () => {
    render(<GraphLegend />);
    const legend = screen.getByRole("list", { name: "Graph legend" });
    for (const text of ["Proposed action", "Agent reacted & proposed its own action", "Event that triggered it", "✓ Allowed", "Blocked / would fail", "optional", "money leaves"]) {
      expect(legend).toHaveTextContent(text);
    }
  });
});

describe("BlastRadius", () => {
  it("states the headline facts first and keeps the rest in details", () => {
    render(<BlastRadius radius={heroDetail.report!.blast_radius} risk={heroDetail.risk!} decision={heroDetail.decision!.decision} />);
    const headline = screen.getByTestId("blast-headline");
    expect(headline).toHaveTextContent("Agents affected3");
    expect(headline).toHaveTextContent("Downstream actions5");
    expect(headline).toHaveTextContent("Exposure₹84,500");
    expect(headline).toHaveTextContent("RiskHIGH · 76");
    expect(headline).toHaveTextContent("DecisionApproval required");
    const region = screen.getByRole("region", { name: "Blast radius" });
    expect(region).toHaveTextContent("₹84,500.00"); // exact amount in the details
    expect(region).toHaveTextContent("PARTIAL");
  });

  it("works with the radius alone", () => {
    render(<BlastRadius radius={heroDetail.report!.blast_radius} />);
    expect(screen.getByTestId("blast-headline")).toHaveTextContent("Agents affected3");
    expect(screen.queryByTestId("headline-risk")).not.toBeInTheDocument();
  });
});
