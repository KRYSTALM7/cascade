import { describe, expect, it } from "vitest";
import { ApiError } from "../api/client";
import { renderWithProviders } from "../test/render";
import { ErrorBanner } from "./ErrorBanner";

describe("ErrorBanner", () => {
  it("shows an accessible, readable API message, code, detail, and request ID", () => {
    const { getByRole } = renderWithProviders(
      <ErrorBanner
        error={new ApiError(
          422,
          "LLM_OUTPUT_INVALID",
          "The request could not be interpreted safely. Rephrase it or use the structured form.",
          { reason: "The parser returned an unsupported tool." },
          "req-123",
        )}
      />,
    );
    const alert = getByRole("alert");
    expect(alert).toHaveTextContent("LLM_OUTPUT_INVALID");
    expect(alert).toHaveTextContent("The request could not be interpreted safely.");
    expect(alert).toHaveTextContent("The parser returned an unsupported tool.");
    expect(alert).toHaveTextContent("Request ID: req-123");
    expect(alert).toHaveClass("bg-rose-50", "text-rose-950");
    expect(alert.className).toContain("overflow-wrap:anywhere");
  });

  it("renders network errors as readable text instead of an object string", () => {
    const { getByRole } = renderWithProviders(<ErrorBanner error={new Error("Cannot reach the Cascade backend.")} />);
    expect(getByRole("alert")).toHaveTextContent("Cannot reach the Cascade backend.");
  });
});
