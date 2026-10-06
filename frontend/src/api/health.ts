import { apiFetch } from "./client";

export interface HealthResponse {
  status: "ok";
  version: string;
}

export interface ReadinessResponse {
  status: "ready";
  database: "ok";
}

export const getHealth = (signal?: AbortSignal) => apiFetch<HealthResponse>("/healthz", { signal });
export const getReadiness = (signal?: AbortSignal) => apiFetch<ReadinessResponse>("/readyz", { signal });
