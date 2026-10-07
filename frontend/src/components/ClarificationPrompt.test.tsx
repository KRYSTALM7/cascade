import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ActionDetail } from "../api/types";
import clarify from "../test/fixtures/clarify.json";
import { ClarificationPrompt } from "./ClarificationPrompt";

const clarification = (clarify as unknown as ActionDetail).action.clarification!;

describe("ClarificationPrompt", () => {
  it("lists the backend's candidates and answers with the chosen one", async () => {
    const onAnswer = vi.fn();
    render(<ClarificationPrompt clarification={clarification} onAnswer={onAnswer} busy={false} />);
    expect(screen.getByText("3 customers match 'John'. Which one?")).toBeInTheDocument();
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual([
      "John Mathew (CUST-1001, VIP, 3 orders)",
      "John Fernandes (CUST-1002, STANDARD, 1 orders)",
      "John D'Souza (CUST-1003, GOLD, 1 orders)",
    ]);
    await userEvent.click(buttons[0]!);
    expect(onAnswer).toHaveBeenCalledWith({ customer_id: "CUST-1001" });
  });

  it("asks for a free-text value when there are no candidates", async () => {
    const onAnswer = vi.fn();
    render(
      <ClarificationPrompt
        clarification={{ field: "order_id", question: "Please provide order_id (e.g. ORD-10482).", candidates: [], missing: ["order_id"] }}
        onAnswer={onAnswer}
        busy={false}
      />,
    );
    await userEvent.type(screen.getByRole("textbox", { name: "order_id" }), "ORD-10510");
    await userEvent.click(screen.getByRole("button", { name: "Answer" }));
    expect(onAnswer).toHaveBeenCalledWith({ order_id: "ORD-10510" });
  });
});
