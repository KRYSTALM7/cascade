import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end demo flows against the real backend with the deterministic `rules` LLM provider.
 * Each test resets NovaCart through /api/demo/reset, so the backend must run with DEMO_MODE=true
 * (it WIPES the database it points at). Already-running dev servers on :8000 / :5173 are reused.
 */
const backendUrl = process.env.E2E_BACKEND_URL ?? "http://localhost:8000";
const webUrl = process.env.E2E_BASE_URL ?? "http://localhost:5173";
const backendCmd = process.env.E2E_BACKEND_CMD ?? `uv run uvicorn app.main:app --port ${new URL(backendUrl).port || "8000"}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1, // one shared demo database
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: webUrl,
    trace: "retain-on-failure",
    viewport: { width: 1440, height: 1000 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } }],
  webServer: [
    {
      command: backendCmd,
      cwd: "../backend",
      url: `${backendUrl}/readyz`,
      reuseExistingServer: true,
      timeout: 60_000,
      env: { DEMO_MODE: "true", LLM_PROVIDER: "rules", LOG_JSON: "false" },
    },
    {
      command: `npm run dev -- --port ${new URL(webUrl).port || "5173"} --strictPort`,
      url: webUrl,
      env: { VITE_DEV_BACKEND_URL: backendUrl },
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
