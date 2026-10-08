import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ActionDetail, ConsequenceReport } from "../api/types";
import hidden from "../test/fixtures/hidden.json";
import { BlastRadius } from "./BlastRadius";
import { CausalChain, PlainChain } from "./CausalChain";
import { ConsequenceGraph } from "./ConsequenceGraph";
import { ProposedAction } from "./ProposedAction";

// Captured from the real API: customer-support trims ORD-10550 from 2 laptops to 1.
const detail = hidden as unknown as ActionDetail;
const report = detail.report!;

describe("hidden cascade", () => {
  it("shows the proposal as authorized, on its own", () => {
    render(<ProposedAction action={detail.action} root={report.nodes[0]!} />);
    const region = screen.getByRole("region", { name: "Proposed action" });
    expect(region).toHaveTextContent("Support agent");
    expect(region).toHaveTextContent("modify order");
    expect(within(region).getByTestId("root-authorization")).toHaveTextContent("✓ Authorized");
  });

  it("headlines the blast radius with backend values and contrasts the action alone with what happens next", () => {
    render(
      <BlastRadius
        radius={report.blast_radius}
        direct={report.direct_effect}
        risk={detail.risk!}
        decision={detail.decision!.decision}
        explanation={detail.explanation}
      />,
    );
    const headline = screen.getByTestId("blast-headline");
    for (const text of ["Agents affected3", "Downstream actions5", "Exposure₹72,000", "RiskHIGH · 68", "DecisionApproval required"]) {
      expect(headline).toHaveTextContent(text);
    }
    const contrast = screen.getByTestId("blast-contrast");
    expect(contrast).toHaveTextContent("On its own: looks safe");
    expect(screen.getByTestId("contrast-alone")).toHaveTextContent("LOW·10/100·Auto-approved·₹0");
    expect(contrast).toHaveTextContent("₹0.00 out");
    expect(contrast).toHaveTextContent("With what happens next");
    expect(screen.getByTestId("contrast-cascade")).toHaveTextContent("HIGH·68/100·Approval required·₹72,000");
    expect(contrast).toHaveTextContent("₹72,000.00 out");
    expect(screen.getByTestId("key-message")).toHaveTextContent("The dangerous part isn't the action we authorized");
    expect(screen.getByRole("region", { name: "Explanation" })).toHaveTextContent("human approver must decide");
    const region = screen.getByRole("region", { name: "Blast radius" });
    expect(region).toHaveTextContent("customer case");
    expect(region).toHaveTextContent("Data sensitivityPII");
  });

  it("marks the root as proposed and every other node as an agent that reacted and proposed under its own permission", () => {
    render(<ConsequenceGraph report={report} />);
    const root = screen.getByTestId("graph-node-n0");
    expect(root).toHaveAttribute("data-trigger", "ROOT");
    expect(root).toHaveTextContent("proposed this action");
    const refund = screen.getByTestId("graph-node-n2");
    expect(refund).toHaveAttribute("data-trigger", "AGENT_REACTION");
    expect(refund).toHaveTextContent("Finance agent");
    expect(refund).toHaveTextContent("reacted & proposed");
    expect(within(refund).getByTestId("node-auth")).toHaveTextContent("✓ Allowed");
    expect(refund.getAttribute("title")).toContain("Authorization:");
    expect(within(refund).getByTestId("money-badge")).toHaveTextContent("−₹72,000.00");
  });

  it("tells the chain in plain words: agent, what it saw, what it proposed, whether it may", () => {
    render(<PlainChain report={report} />);
    const items = within(screen.getByRole("list", { name: "What each agent does" })).getAllByRole("listitem");
    expect(items).toHaveLength(5);
    const finance = screen.getByTestId("plain-n2");
    for (const text of ["Finance agent", "saw “Order was modified”", "Issue refund", "₹72,000.00", "✓ Allowed", "Finance refunds the difference when an order gets cheaper."]) {
      expect(finance).toHaveTextContent(text);
    }
    expect(finance).not.toHaveTextContent("finance.refund_on_downsize");
    expect(screen.getByTestId("plain-n4")).toHaveTextContent("saw “Refund was issued” (from Finance agent)");
    expect(screen.getByTestId("plain-n3")).toHaveTextContent("optional");
  });

  it("spells out event → rule → agent → proposal → own authorization → simulation", () => {
    render(<CausalChain report={report} />);
    const items = within(screen.getByRole("list", { name: "Agent-triggered consequences" })).getAllByRole("listitem");
    expect(items).toHaveLength(5);
    const finance = screen.getByTestId("chain-n2");
    for (const text of ["modify order emits ORDER_MODIFIED", "finance.refund_on_downsize@1", "if TOTAL_DECREASED", "Finance", "issue refund", "₹72,000.00", "✓ granted"]) {
      expect(finance).toHaveTextContent(text);
    }
  });

  it("shows a downstream authorization failure where it happens", () => {
    const denied: ConsequenceReport = {
      ...report,
      nodes: report.nodes.map((n) =>
        n.id === "n2"
          ? { ...n, status: "BLOCKED", status_code: "DOWNSTREAM_NOT_PERMITTED", authorization: { granted: false, code: "DOWNSTREAM_NOT_PERMITTED", message: "no" } }
          : n,
      ),
    };
    render(<CausalChain report={denied} />);
    const finance = screen.getByTestId("chain-n2");
    expect(finance).toHaveTextContent("✗ DOWNSTREAM_NOT_PERMITTED");
    expect(finance).toHaveTextContent("blocked · DOWNSTREAM_NOT_PERMITTED");
  });
});
