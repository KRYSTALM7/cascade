import { apiFetch } from "./client";
import type {
  ActionDetail,
  ActionSummary,
  AgentSummary,
  AuditEntry,
  DemoUser,
  EscapeResult,
  EscapeScenario,
  OrderDetail,
  Reaction,
  Tool,
  WhatIfResult,
} from "./types";

const post = <T>(path: string, userId: string, body: unknown = {}) =>
  apiFetch<T>(path, { method: "POST", body: JSON.stringify(body), headers: { "X-User-Id": userId } });

export const api = {
  parse: (userId: string, agentId: string, text: string) =>
    post<ActionDetail>("/api/actions/parse", userId, { agent_id: agentId, text }),
  clarify: (userId: string, actionId: string, answers: Record<string, unknown>) =>
    post<ActionDetail>(`/api/actions/${actionId}/clarify`, userId, { answers }),
  simulateAction: (userId: string, actionId: string) => post<ActionDetail>("/api/actions/simulate", userId, { action_id: actionId }),
  simulateStructured: (userId: string, agentId: string, tool: string, parameters: Record<string, unknown>) =>
    post<ActionDetail>("/api/actions/simulate", userId, { agent_id: agentId, tool, parameters }),
  approve: (userId: string, actionId: string) => post<ActionDetail>(`/api/actions/${actionId}/approve`, userId),
  reject: (userId: string, actionId: string) => post<ActionDetail>(`/api/actions/${actionId}/reject`, userId),
  execute: (userId: string, actionId: string) => post<ActionDetail>(`/api/actions/${actionId}/execute`, userId),
  whatIf: (userId: string, actionId: string, text: string) => post<WhatIfResult>(`/api/actions/${actionId}/what-if`, userId, { text }),
  escapeRoom: () => apiFetch<EscapeScenario[]>("/api/escape-room"),
  runScenario: (id: string) => apiFetch<EscapeResult>(`/api/escape-room/${id}/run`, { method: "POST" }),
  reset: () => apiFetch<{ seeded: Record<string, number> }>("/api/demo/reset", { method: "POST" }),

  action: (actionId: string) => apiFetch<ActionDetail>(`/api/actions/${actionId}`),
  actions: () => apiFetch<ActionSummary[]>("/api/actions?limit=100"),
  actionAudit: (actionId: string) => apiFetch<AuditEntry[]>(`/api/actions/${actionId}/audit`),
  audit: (eventType?: string) =>
    apiFetch<AuditEntry[]>(`/api/audit?limit=200${eventType ? `&event_type=${encodeURIComponent(eventType)}` : ""}`),
  users: () => apiFetch<DemoUser[]>("/api/users"),
  agents: () => apiFetch<AgentSummary[]>("/api/agents"),
  tools: () => apiFetch<Tool[]>("/api/tools"),
  reactions: () => apiFetch<Reaction[]>("/api/reactions"),
  order: (orderId: string) => apiFetch<OrderDetail>(`/api/orders/${encodeURIComponent(orderId)}`),
};
