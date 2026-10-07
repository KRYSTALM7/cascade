import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ActionDetail } from "../api/types";
import blocked from "../test/fixtures/blocked.json";
import hero from "../test/fixtures/hero.json";
import { BlastRadius } from "./BlastRadius";
import { ConsequenceGraph } from "./ConsequenceGraph";

const heroDetail = hero as unknown as ActionDetail;
const blockedDetail = blocked as unknown as ActionDetail;

describe("ConsequenceGraph", () => {
  it("renders one node per consequence, coloured by agent, with money on the refund", () => {
    render(<ConsequenceGraph report={heroDetail.report!} />);
    for (const id of ["n0", "n1", "n2", "n3", "n4", "n5"]) {
      expect(screen.getByTestId(`graph-node-${id}`)).toBeInTheDocument();
    }
    const refund = screen.getByTestId("graph-node-n1");
    expect(within(refund).getByText("issue refund")).toBeInTheDocument();
    expect(within(refund).getByText("finance.refund_on_cancel@1")).toBeInTheDocument();
    expect(within(refund).getByTestId("money-badge")).toHaveTextContent("−₹84,500.00");
    expect(screen.getAllByTestId("money-badge")).toHaveLength(1);
    expect(within(screen.getByTestId("graph-node-n0")).getByText("Support · proposed")).toBeInTheDocument();
  });

  it("styles a blocked node and names the reason", () => {
    render(<ConsequenceGraph report={blockedDetail.report!} />);
    const node = screen.getByTestId("graph-node-n0");
    expect(node).toHaveAttribute("data-status", "BLOCKED");
    expect(within(node).getByText("BLOCKED")).toBeInTheDocument();
    expect(within(node).getByText("TOOL_NOT_PERMITTED")).toBeInTheDocument();
  });

  it("lists every step for assistive technology", () => {
    render(<ConsequenceGraph report={heroDetail.report!} />);
    const list = screen.getByRole("list", { name: "Consequence steps" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(6);
  });
});

describe("BlastRadius", () => {
  it("states the headline facts in one row", () => {
    render(<BlastRadius radius={heroDetail.report!.blast_radius} />);
    const region = screen.getByRole("region", { name: "Blast radius" });
    expect(region).toHaveTextContent("₹84,500.00");
    expect(region).toHaveTextContent("Agents affected3");
    expect(region).toHaveTextContent("Downstream actions5");
    expect(region).toHaveTextContent("PARTIAL");
  });
});
