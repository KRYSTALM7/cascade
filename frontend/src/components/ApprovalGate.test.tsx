import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionDetail } from "../api/types";
import approved from "../test/fixtures/hero-approved.json";
import blocked from "../test/fixtures/blocked.json";
import hero from "../test/fixtures/hero.json";
import executed from "../test/fixtures/hidden-executed.json";
import { jsonResponse, renderWithProviders } from "../test/render";
import { ApprovalGate } from "./ApprovalGate";

afterEach(() => vi.unstubAllGlobals());

const USERS = [
  { id: "approver-asha", name: "Asha Menon (Finance Lead)", role: "APPROVER", approval_limit: "100000.00" },
  { id: "approver-dev", name: "Dev Patel (Team Lead)", role: "APPROVER", approval_limit: "10000.00" },
  { id: "ops-ravi", name: "Ravi Kumar (Support Ops)", role: "OPERATOR", approval_limit: null },
  { id: "viewer-kim", name: "Kim Lee (Auditor)", role: "VIEWER", approval_limit: null },
];

const base = hero as unknown as ActionDetail;
// The captured fixture's approval window is in the past; give it a live one.
const pending: ActionDetail = { ...base, approval: { ...base.approval!, expires_at: new Date(Date.now() + 20 * 60_000).toISOString() } };

/** fetch stub: /api/users answers the directory; everything else goes to `handler` (default 200 {}). */
function stubFetch(handler: (url: string, init?: RequestInit) => Response = () => jsonResponse(200, {})) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => Promise.resolve(url === "/api/users" ? jsonResponse(200, USERS) : handler(url, init)));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const actionCalls = (m: ReturnType<typeof stubFetch>) => m.mock.calls.filter(([u]) => u !== "/api/users") as [string, RequestInit][];

describe("ApprovalGate", () => {
  it("presents a pending approval as a control gate: why, amount, risk, requester, expiry", async () => {
    stubFetch();
    renderWithProviders(<ApprovalGate detail={pending} onChange={vi.fn()} />, { user: "approver-asha" });
    const gate = screen.getByRole("region", { name: "Approval gate" });
    expect(gate).toHaveTextContent("APPROVAL REQUIRED");
    expect(screen.getByTestId("action-status")).toHaveTextContent("Pending approval");
    expect(gate).toHaveTextContent("₹84,500.00 would leave NovaCart, above the ₹2,000.00 auto-approve limit.");
    expect(gate).toHaveTextContent("₹84,500");
    expect(gate).toHaveTextContent("HIGH · 76/100");
    await screen.findByText("Ravi Kumar (Support Ops)");
    expect(screen.getByTestId("requested-by")).toHaveTextContent("Support agent · on behalf of Ravi Kumar (Support Ops)");
    expect(screen.getByTestId("approval-countdown").textContent).toMatch(/^(19|20):\d\d$/);
  });

  it("Approve & Execute approves, then executes, as the selected approver", async () => {
    const fetchMock = stubFetch((url) => jsonResponse(200, url.endsWith("/approve") ? approved : executed));
    const onChange = vi.fn();
    renderWithProviders(<ApprovalGate detail={pending} onChange={onChange} />, { user: "approver-asha" });
    await userEvent.click(await screen.findByRole("button", { name: "Approve & Execute" }));

    const calls = actionCalls(fetchMock);
    expect(calls.map(([u]) => u)).toEqual([`/api/actions/${pending.action.id}/approve`, `/api/actions/${pending.action.id}/execute`]);
    for (const [, init] of calls) {
      expect(init.method).toBe("POST");
      expect(init.headers).toMatchObject({ "X-User-Id": "approver-asha" });
    }
    expect(onChange).toHaveBeenNthCalledWith(1, approved);
    expect(onChange).toHaveBeenNthCalledWith(2, executed);
  });

  it("Approve only approves", async () => {
    const fetchMock = stubFetch(() => jsonResponse(200, approved));
    const onChange = vi.fn();
    renderWithProviders(<ApprovalGate detail={pending} onChange={onChange} />, { user: "approver-asha" });
    await userEvent.click(await screen.findByRole("button", { name: "Approve only" }));
    expect(actionCalls(fetchMock).map(([u]) => u)).toEqual([`/api/actions/${pending.action.id}/approve`]);
    expect(onChange).toHaveBeenCalledWith(approved);
  });

  it("shows the backend's refusal when the approver's limit is too low, and executes nothing", async () => {
    const fetchMock = stubFetch(() =>
      jsonResponse(403, {
        error: {
          code: "APPROVAL_LIMIT_EXCEEDED",
          message: "approver-dev may approve up to ₹10,000.00; this action moves ₹84,500.00.",
          details: {},
          request_id: "r1",
        },
      }),
    );
    const onChange = vi.fn();
    renderWithProviders(<ApprovalGate detail={pending} onChange={onChange} />, { user: "approver-dev" });
    await userEvent.click(await screen.findByRole("button", { name: "Approve & Execute" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("APPROVAL_LIMIT_EXCEEDED");
    expect(actionCalls(fetchMock).map(([u]) => u)).toEqual([`/api/actions/${pending.action.id}/approve`]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("guides an operator to an authorized approver instead of offering a button that would fail", async () => {
    stubFetch();
    renderWithProviders(<ApprovalGate detail={pending} onChange={vi.fn()} />, { user: "ops-ravi" });
    const guide = await screen.findByTestId("persona-guide");
    expect(guide).toHaveTextContent("You're acting as Ravi Kumar (Support Ops) · Operator.");
    expect(guide).toHaveTextContent("Approval requires an authorized approver.");
    expect(screen.queryByRole("button", { name: /Approve/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();

    await userEvent.click(within(guide).getByRole("button", { name: /Act as Asha Menon/ }));
    expect(await screen.findByRole("button", { name: "Approve & Execute" })).toBeInTheDocument();
  });

  it("explains self-approval when the approver is the requester", async () => {
    stubFetch();
    const own: ActionDetail = { ...pending, action: { ...pending.action, proposed_by: "approver-asha" } };
    renderWithProviders(<ApprovalGate detail={own} onChange={vi.fn()} />, { user: "approver-asha" });
    const guide = await screen.findByTestId("persona-guide");
    expect(guide).toHaveTextContent("You requested this action, so you cannot approve it yourself.");
    expect(within(guide).getByRole("button", { name: /Act as Dev Patel/ })).toBeInTheDocument();
    expect(within(guide).queryByRole("button", { name: /Act as Asha/ })).not.toBeInTheDocument();
  });

  it("offers Execute once approved, names the approver, and nothing for a blocked action", async () => {
    stubFetch();
    const { unmount } = renderWithProviders(<ApprovalGate detail={approved as unknown as ActionDetail} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Execute" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Approve/ })).not.toBeInTheDocument();
    expect(await screen.findByText("Asha Menon (Finance Lead)")).toBeInTheDocument();
    unmount();

    renderWithProviders(<ApprovalGate detail={blocked as unknown as ActionDetail} onChange={vi.fn()} />);
    expect(screen.getByTestId("action-status")).toHaveTextContent("Blocked");
    expect(screen.getByRole("region", { name: "Approval gate" })).toHaveTextContent("Agent customer-support is not permitted to call issue_refund.");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("turns an expired approval into a Re-simulate of the same request", async () => {
    const fetchMock = stubFetch(() => jsonResponse(200, base));
    const expired: ActionDetail = { ...base, action: { ...base.action, status: "EXPIRED" }, approval: { ...base.approval!, status: "EXPIRED" } };
    renderWithProviders(<ApprovalGate detail={expired} onChange={vi.fn()} />, { user: "ops-ravi" });
    expect(screen.getByRole("region", { name: "Approval gate" })).toHaveTextContent("APPROVAL EXPIRED");
    await userEvent.click(screen.getByRole("button", { name: "Re-simulate" }));
    const [url, init] = actionCalls(fetchMock)[0]!;
    expect(url).toBe("/api/actions/simulate");
    expect(JSON.parse(String(init.body))).toEqual({ agent_id: "customer-support", tool: "cancel_order", parameters: { order_id: "ORD-10482" } });
  });

  it("treats a pending approval whose window has passed as expired", () => {
    stubFetch();
    renderWithProviders(<ApprovalGate detail={base} onChange={vi.fn()} />, { user: "approver-asha" });
    expect(screen.getByRole("region", { name: "Approval gate" })).toHaveTextContent("APPROVAL EXPIRED");
    expect(screen.queryByRole("button", { name: "Approve & Execute" })).not.toBeInTheDocument();
  });

  it("after a rejection offers Re-simulate and a safer option", async () => {
    stubFetch();
    const rejected: ActionDetail = {
      ...base,
      action: { ...base.action, status: "REJECTED" },
      approval: { ...base.approval!, status: "REJECTED", decided_by: "approver-asha" },
    };
    renderWithProviders(<ApprovalGate detail={rejected} onChange={vi.fn()} />);
    const gate = screen.getByRole("region", { name: "Approval gate" });
    expect(gate).toHaveTextContent("REJECTED");
    expect(await within(gate).findByText("Asha Menon (Finance Lead)")).toBeInTheDocument();
    expect(within(gate).getByRole("button", { name: "Re-simulate" })).toBeInTheDocument();
    expect(within(gate).getByRole("link", { name: "Look for a safer option ↓" })).toHaveAttribute("href", "#step-whatif");
  });
});
