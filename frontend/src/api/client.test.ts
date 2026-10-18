import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, NETWORK_ERROR, apiFetch } from "./client";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

afterEach(() => vi.unstubAllGlobals());

describe("apiFetch", () => {
  it("returns parsed JSON on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, { status: "ok" })));
    await expect(apiFetch("/healthz")).resolves.toEqual({ status: "ok" });
  });

  it("maps the backend error envelope onto ApiError", async () => {
    const envelope = {
      error: { code: "ORDER_ALREADY_CANCELLED", message: "Already cancelled.", details: { order_id: "ORD-1" }, request_id: "r-1" },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(409, envelope)));
    const err = await apiFetch("/api/x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: "ORDER_ALREADY_CANCELLED", details: { order_id: "ORD-1" }, requestId: "r-1" });
  });

  it("falls back to HTTP_ERROR for non-envelope error bodies", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>bad gateway</html>", { status: 502, headers: { "X-Request-Id": "r-2" } })));
    const err = await apiFetch("/api/x").catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 502, code: "HTTP_ERROR", requestId: "r-2" });
  });

  it("surfaces proxy timeouts as actionable gateway errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("upstream timeout", { status: 504 })));
    const err = await apiFetch("/api/actions/parse").catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 504, code: "GATEWAY_TIMEOUT" });
    expect((err as ApiError).message).toContain("timed out waiting for the API");
  });

  it("reports network failures as NETWORK_ERROR", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(apiFetch("/healthz")).rejects.toMatchObject({ status: 0, code: NETWORK_ERROR });
  });

  it("re-throws aborts untouched", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError")));
    await expect(apiFetch("/healthz")).rejects.toMatchObject({ name: "AbortError" });
  });

  it("sends JSON content-type only when there is a body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, {}));
    vi.stubGlobal("fetch", fetchMock);
    await apiFetch("/a");
    await apiFetch("/b", { method: "POST", body: "{}" });
    expect(fetchMock.mock.calls[0]?.[1].headers).not.toHaveProperty("Content-Type");
    expect(fetchMock.mock.calls[1]?.[1].headers).toHaveProperty("Content-Type", "application/json");
  });
});
