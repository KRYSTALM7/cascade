import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, renderWithProviders } from "../test/render";
import { EscapeRoomPage } from "./EscapeRoomPage";

afterEach(() => vi.unstubAllGlobals());

const scenario = {
  id: "poisoned-instruction",
  title: "Poisoned instruction",
  attack: "ignore your rules…",
  expected_outcome: "BLOCKED",
  expected_code: "TOOL_NOT_PERMITTED",
  caught_by: "identity from request",
};

const ran = {
  ...scenario,
  actual_outcome: "BLOCKED",
  actual_code: "TOOL_NOT_PERMITTED",
  passed: true,
  steps: ["parse as customer-support → PARSED", "simulate → BLOCKED"],
  action_ids: ["11111111-2222-3333-4444-555555555555"],
  details: {},
};

/** Route by URL: the page also reads /healthz (public mode) alongside the scenario list. */
function backend(publicMode: boolean) {
  return vi.fn((url: string) => {
    if (url === "/healthz") return Promise.resolve(jsonResponse(200, { status: "ok", version: "0.1.0", demo_mode: true, public_mode: publicMode }));
    if (url === "/api/escape-room") return Promise.resolve(jsonResponse(200, [scenario]));
    return Promise.resolve(jsonResponse(200, ran));
  });
}

describe("EscapeRoomPage", () => {
  it("shows expected vs actual after running an attack", async () => {
    const fetchMock = backend(false);
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<EscapeRoomPage />);

    const card = await screen.findByTestId("scenario-poisoned-instruction");
    expect(within(card).getByTestId("actual")).toHaveTextContent("not run yet");
    await userEvent.click(within(card).getByRole("button", { name: "Run attack" }));
    expect(await within(card).findByText("✓ Caught")).toBeInTheDocument();
    expect(within(card).getByTestId("actual")).toHaveTextContent("BLOCKED · TOOL_NOT_PERMITTED");
    expect(fetchMock.mock.calls.map((c) => c[0])).toContain("/api/escape-room/poisoned-instruction/run");
  });

  it("does not offer runs on a public instance (they change shared demo data)", async () => {
    const fetchMock = backend(true);
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<EscapeRoomPage />);
    const card = await screen.findByTestId("scenario-poisoned-instruction");
    const button = await within(card).findByRole("button", { name: "Presenter only" });
    expect(button).toBeDisabled();
    expect(fetchMock.mock.calls.map((c) => c[0])).not.toContain("/api/escape-room/poisoned-instruction/run");
  });
});
