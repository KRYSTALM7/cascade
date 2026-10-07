import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionDetail } from "../api/types";
import approved from "../test/fixtures/hero-approved.json";
import blocked from "../test/fixtures/blocked.json";
import hero from "../test/fixtures/hero.json";
import { jsonResponse, renderWithProviders } from "../test/render";
import { DecisionBar } from "./DecisionBar";

afterEach(() => vi.unstubAllGlobals());

const pending = hero as unknown as ActionDetail;

describe("DecisionBar (approval flow)", () => {
  it("approves as the selected demo user and shows the new state", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, approved));
    vi.stubGlobal("fetch", fetchMock);
    const onChange = vi.fn();
    renderWithProviders(<DecisionBar detail={pending} onChange={onChange} />, { user: "approver-asha" });

    expect(screen.getByTestId("action-status")).toHaveTextContent("Pending approval");
    await userEvent.click(screen.getByRole("button", { name: "Approve as approver-asha" }));

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/actions/${pending.action.id}/approve`);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "X-User-Id": "approver-asha" });
    expect(onChange).toHaveBeenCalledWith(approved);
  });

  it("shows the backend's refusal when the approver's limit is too low", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(403, {
          error: {
            code: "APPROVAL_LIMIT_EXCEEDED",
            message: "approver-dev may approve up to ₹10,000.00; this action moves ₹84,500.00.",
            details: {},
            request_id: "r1",
          },
        }),
      ),
    );
    const onChange = vi.fn();
    renderWithProviders(<DecisionBar detail={pending} onChange={onChange} />, { user: "approver-dev" });
    await userEvent.click(screen.getByRole("button", { name: "Approve as approver-dev" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("APPROVAL_LIMIT_EXCEEDED");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("offers Execute once approved and nothing for a blocked action", () => {
    const { unmount } = renderWithProviders(<DecisionBar detail={approved as unknown as ActionDetail} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Execute" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Approve/ })).not.toBeInTheDocument();
    expect(screen.getByText("approver-asha")).toBeInTheDocument();
    unmount();

    renderWithProviders(<DecisionBar detail={blocked as unknown as ActionDetail} onChange={vi.fn()} />);
    expect(screen.getByTestId("action-status")).toHaveTextContent("Blocked");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
