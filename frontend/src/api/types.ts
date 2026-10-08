/** Mirrors the backend contracts (backend/app/schemas/*, domain/consequence/report.py). Money is a decimal STRING. */

export type Money = string;
export type NodeStatus = "WILL_EXECUTE" | "BLOCKED" | "WOULD_FAIL" | "SKIPPED_LIMIT";
export type EdgeKind = "TRIGGER" | "DUPLICATE" | "CYCLE";
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type Decision = "AUTO_APPROVED" | "APPROVAL_REQUIRED" | "BLOCKED";
export type Reversibility = "FULL" | "PARTIAL" | "NONE";
export type ActionStatus =
  | "PARSED"
  | "NEEDS_CLARIFICATION"
  | "SIMULATED"
  | "BLOCKED"
  | "AUTO_APPROVED"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "REJECTED"
  | "EXPIRED"
  | "STALE"
  | "EXECUTING"
  | "EXECUTED"
  | "PARTIALLY_EXECUTED"
  | "FAILED";

export interface ChangeOut {
  resource_type: string;
  resource_id: string;
  field: string;
  before: unknown;
  after: unknown;
}

export interface MoneyOut {
  direction: "OUT" | "IN";
  amount: Money;
  kind: string;
  description: string;
}

/** The node's own, independent authorization check (never inherited from the proposer). */
export interface Authorization {
  granted: boolean;
  code: string | null;
  message: string;
}

export interface EventOut {
  type: string;
  payload: Record<string, unknown>;
}

export interface GraphNode {
  id: string;
  depth: number;
  agent_id: string;
  tool_id: string;
  params: Record<string, unknown>;
  parent_id: string | null;
  trigger_type: "ROOT" | "AGENT_REACTION";
  trigger_event: string | null;
  rule_id: string | null;
  rule_version: number | null;
  trigger_condition?: string | null;
  trigger_reason?: string | null;
  authorization?: Authorization | null;
  required: boolean;
  status: NodeStatus;
  status_code: string | null;
  status_message: string | null;
  summary: string;
  reversibility: Reversibility;
  customer_impact: string;
  data_sensitivity: string;
  changes: ChangeOut[];
  creations: { resource_type: string; values: Record<string, unknown> }[];
  money: MoneyOut[];
  events?: EventOut[];
}

export interface GraphEdge {
  source: string;
  target: string;
  kind: EdgeKind;
  event: string | null;
  rule_id: string | null;
  rule_version: number | null;
}

export interface EngineReason {
  code: string;
  message: string;
  node_id: string | null;
  details: Record<string, unknown>;
}

export interface BlastRadius {
  agents_affected: string[];
  agent_count: number;
  downstream_actions: number;
  records_affected: string[];
  record_count: number;
  systems_affected?: string[];
  money_out: Money;
  money_in: Money;
  net_money_out: Money;
  customer_impact: string;
  data_sensitivity: string;
  reversibility: Reversibility;
  irreversible_nodes: string[];
  blocked_nodes: string[];
  would_fail_nodes: string[];
  skipped_nodes: string[];
}

export interface ConsequenceReport {
  engine_version: string;
  proposer_agent_id: string;
  root_tool_id: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  blast_radius: BlastRadius;
  /** The proposed action alone (root node only), for contrast with the full cascade. */
  direct_effect?: BlastRadius | null;
  fingerprint: string;
  config?: {
    reaction_rules: { id: string; version: number; enabled: boolean; digest: string }[];
    rules_fingerprint: string;
    catalog_fingerprint: string;
  } | null;
  execution_order: string[];
  blocking: EngineReason[];
  warnings: EngineReason[];
  limit_reached: boolean;
  cycle_detected: boolean;
}

export interface PolicyReason {
  code: string;
  severity: "BLOCK" | "APPROVAL" | "INFO";
  message: string;
  node_id: string | null;
  details: Record<string, unknown>;
}

export interface RiskDimension {
  key: "financial" | "irreversibility" | "downstream" | "customer" | "data";
  label: string;
  score: string;
  weight: string;
  contribution: string;
  explanation: string;
}

export interface RiskAssessment {
  score: number;
  raw_score: number;
  level: RiskLevel;
  dimensions: RiskDimension[];
  reasons: PolicyReason[];
  policy_version: string;
  policy_fingerprint?: string;
  /** The proposed action scored and decided as if no agent reacted (backend-computed). */
  direct?: { score: number; level: RiskLevel; decision: Decision; reasons: string[] } | null;
}

export interface Candidate {
  field: string;
  value: string;
  label: string;
}

export interface Clarification {
  field: string;
  question: string;
  candidates: Candidate[];
  missing: string[];
}

export interface ActionOut {
  id: string;
  status: ActionStatus;
  decision: Decision | null;
  agent_id: string;
  tool_id: string | null;
  parameters: Record<string, unknown>;
  raw_text: string | null;
  parser: string | null;
  proposed_by: string | null;
  idempotency_key: string | null;
  parent_action_id: string | null;
  clarification: Clarification | null;
  interpretation: { injection_markers?: string[] } | null;
  created_at: string;
  updated_at: string;
}

export interface Explanation {
  summary: string;
  bullets: string[];
  source: "gemini" | "rules" | "template_fallback" | string;
  rejected_figures: string[];
}

export interface ApprovalOut {
  status: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";
  expires_at: string;
  decided_by: string | null;
  decided_at: string | null;
  comment: string | null;
}

export interface ExecutionStep {
  node_id: string;
  agent_id: string;
  tool_id: string;
  required: boolean;
  status: "APPLIED" | "FAILED" | "SKIPPED";
  error?: string;
}

export interface ExecutionOut {
  attempt: number;
  status: "RUNNING" | "SUCCEEDED" | "PARTIAL" | "FAILED";
  steps: ExecutionStep[];
  error: { code: string; tool_id: string; message: string } | null;
  started_at: string;
  finished_at: string | null;
}

export interface ActionDetail {
  action: ActionOut;
  report: ConsequenceReport | null;
  risk: RiskAssessment | null;
  decision: { decision: Decision; reasons: PolicyReason[]; money_out: Money; policy_version: string } | null;
  explanation: Explanation | null;
  approval: ApprovalOut | null;
  executions: ExecutionOut[];
}

export interface ActionSummary {
  id: string;
  status: ActionStatus;
  decision: Decision | null;
  agent_id: string;
  tool_id: string | null;
  title: string;
  proposed_by: string | null;
  risk_score: number | null;
  risk_level: RiskLevel | null;
  money_out: Money | null;
  parent_action_id: string | null;
  created_at: string;
}

export interface Side {
  action_id: string;
  title: string;
  money_out: Money;
  agents: string[];
  downstream_actions: number;
  records_affected: number;
  risk_score: number;
  risk_level: RiskLevel;
  reversibility: Reversibility;
  decision: Decision;
}

export interface WhatIfResult {
  comparison: {
    base: Side;
    alternative: Side;
    delta: { money_out: Money; agents: number; downstream_actions: number; records_affected: number; risk_score: number };
    lower_risk: boolean;
    explanation: Explanation;
  };
  alternative: ActionDetail;
}

export interface AuditEntry {
  id: number;
  action_id: string | null;
  event_type: string;
  actor_type: string;
  actor_id: string | null;
  payload: Record<string, unknown>;
  request_id: string | null;
  created_at: string;
}

export interface DemoUser {
  id: string;
  name: string;
  role: "VIEWER" | "OPERATOR" | "APPROVER";
  approval_limit: Money | null;
}

export interface Tool {
  id: string;
  owner_agent_id: string;
  name: string;
  description: string;
  enabled: boolean;
  reversibility: Reversibility;
  customer_impact: string;
  data_sensitivity: string;
  read_only: boolean;
}

export interface Reaction {
  id: string;
  agent_id: string;
  event_type: string;
  condition_key: string;
  condition_params: Record<string, unknown>;
  tool_id: string;
  param_mapping: Record<string, unknown>;
  required: boolean;
  priority: number;
  enabled: boolean;
  version: number;
  description: string;
}

export interface AgentSummary {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  owned_tools: string[];
  permitted_tools: string[];
}

export interface OrderDetail {
  id: string;
  status: string;
  total_amount: Money;
  version: number;
  customer: { id: string; name: string; tier: string; status: string };
  items: { sku: string; quantity: number; unit_price: Money; reserved_quantity: number }[];
  payments: { id: string; amount: Money; refunded_amount: Money; method: string; status: string }[];
}

export interface EscapeScenario {
  id: string;
  title: string;
  attack: string;
  expected_outcome: string;
  expected_code: string;
  caught_by: string;
}

export interface EscapeResult extends EscapeScenario {
  actual_outcome: string;
  actual_code: string | null;
  passed: boolean;
  steps: string[];
  action_ids: string[];
  details: Record<string, unknown>;
}
