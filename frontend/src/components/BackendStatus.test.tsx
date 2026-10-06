import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BackendStatus } from "./BackendStatus";

afterEach(() => vi.unstubAllGlobals());

const respond = (status: number, body: unknown) =>
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })));

describe("BackendStatus", () => {
  it("starts in checking state", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<BackendStatus />);
    expect(screen.getByRole("status")).toHaveTextContent("Checking backend");
  });

  it("shows ready when /readyz succeeds", async () => {
    respond(200, { status: "ready", database: "ok" });
    render(<BackendStatus />);
    expect(await screen.findByText("Backend ready")).toBeInTheDocument();
  });

  it("shows degraded with the backend's message when the DB is down", async () => {
    respond(503, { error: { code: "SERVICE_UNAVAILABLE", message: "Database is not reachable.", details: {}, request_id: "r" } });
    render(<BackendStatus />);
    expect(await screen.findByText("Backend degraded")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Database is not reachable.");
  });

  it("shows unreachable on network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    render(<BackendStatus />);
    expect(await screen.findByText("Backend unreachable")).toBeInTheDocument();
  });
});
