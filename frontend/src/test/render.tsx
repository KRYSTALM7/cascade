import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router";
import { UserProvider } from "../components/UserProvider";

/** Render with the same providers as main.tsx; fresh query cache per test. */
export function renderWithProviders(ui: ReactElement, { user = "ops-ravi", route = "/" } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <UserProvider initial={user}>{ui}</UserProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

export const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
