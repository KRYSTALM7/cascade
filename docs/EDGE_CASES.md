# Edge-case matrix

Every row has a stable ID, the **exact** expected behaviour, and the test that proves it. A phase is not done until its rows are ✅. IDs never change meaning; retired rows are struck through, not reused.

Legend: ✅ tested · ⏳ planned (phase) · Error codes are the `error.code` in the API envelope.

## INF — HTTP / infrastructure (Phase 1)

| ID | Case | Expected behaviour | Test |
|---|---|---|---|
| INF-01 | Unknown route | 404 `NOT_FOUND` envelope with request id | ✅ `api/test_http_contract::test_unknown_route_uses_envelope` |
| INF-02 | Wrong HTTP method | 405 `METHOD_NOT_ALLOWED` envelope | ✅ `…::test_wrong_method_uses_envelope` |
| INF-03 | Body fails schema | 422 `VALIDATION_ERROR` with field locations | ✅ `…::test_validation_error_uses_envelope_with_field_locations` |
| INF-04 | Malformed JSON body | 422 `VALIDATION_ERROR` | ✅ `…::test_malformed_json_uses_envelope` |
| INF-05 | Unhandled exception | 500 `INTERNAL_ERROR`; no internals leaked; request id present | ✅ `…::test_unexpected_error_is_500_envelope_without_leaking_internals` |
| INF-06 | Database down | `/readyz` 503 `SERVICE_UNAVAILABLE`; driver error not leaked | ✅ `…::test_readyz_returns_503_envelope_when_database_is_down` |
| INF-07 | Hostile `X-Request-Id` (long, markup, spaces) | Replaced with server-generated id | ✅ `…::test_unsafe_client_request_id_is_replaced` |
| INF-08 | CORS from unlisted origin | No `Access-Control-Allow-Origin` | ✅ `…::test_cors_allows_configured_origin_only` |
| INF-09 | `LLM_PROVIDER=gemini` with blank/missing key | Startup refused (config error) | ✅ `unit/test_config::test_blank_api_key_counts_as_missing` |
| INF-10 | Wildcard CORS configured | Startup refused | ✅ `unit/test_config::test_wildcard_cors_is_rejected` |
| INF-11 | Secret in logs/repr | API key never rendered | ✅ `unit/test_config::test_api_key_is_never_rendered` |

## DATA — persistence integrity (Phase 2)

| ID | Case | Expected behaviour | Test |
|---|---|---|---|
| DATA-01 | Negative money / refund > payment / reserved > on-hand / zero quantity | DB rejects (CHECK) | ✅ `integration/test_constraints::test_invalid_states_are_rejected_by_the_database` |
| DATA-02 | Invalid enum (status, event type, condition key) | Rejected in app and in DB | ✅ `…::test_invalid_enum_is_rejected_before_reaching_the_database` + CHECK rows above |
| DATA-03 | Duplicate permission | Unique violation | ✅ `…::test_duplicate_permission_is_rejected` |
| DATA-04 | Money precision | Exact `Decimal` round trip; API serialises as string | ✅ `…::test_money_round_trips_exactly_as_decimal`, `api/test_catalog_api::test_order_detail_serialises_money_as_exact_strings` |
| DATA-05 | Concurrent write to same row | `StaleDataError` (optimistic lock), never silent overwrite | ✅ `…::test_concurrent_write_raises_stale_data_instead_of_overwriting` |
| DATA-06 | Models drift from migrations | Test fails | ✅ `integration/test_database::test_models_and_migrations_have_no_drift` |
| DATA-07 | Seed re-run | Identical state, no duplicates | ✅ `integration/test_seed::test_seed_is_idempotent` |
| DATA-08 | Reaction rule its agent may not execute | Seed invariant test fails (would block every happy path) | ✅ `…::test_every_reaction_rule_is_executable_by_its_agent` |
| DATA-09 | Name search with `%`, `_`, `\` | Treated literally, no wildcard match | ✅ `…::test_customer_search_treats_wildcards_literally` |

## AGT — agent (Phase 3 engine / Phase 6 API)

| ID | Case | Expected behaviour | Test |
|---|---|---|---|
| AGT-01 | Unknown agent | `BLOCKED · AGENT_UNKNOWN`; action recorded for audit | ⏳ P3 |
| AGT-02 | Disabled agent (proposer) | `BLOCKED · AGENT_DISABLED` | ⏳ P3 |
| AGT-03 | Agent calls tool without permission | `BLOCKED · TOOL_NOT_PERMITTED` | ⏳ P3 |
| AGT-04 | Permission expired (`expires_at <= now`) | `BLOCKED · PERMISSION_EXPIRED` (boundary: equal = expired) | ⏳ P3 |
| AGT-05 | Agent attempts another agent's tool | Same as AGT-03 — ownership never implies permission | ⏳ P3 |
| AGT-06 | Unknown agent id in API detail | 404 `AGENT_NOT_FOUND` | ✅ `api/test_catalog_api::test_unknown_agent_is_404_with_envelope` |

## TOOL — tool & parameters (Phase 3)

| ID | Case | Expected behaviour | Test |
|---|---|---|---|
| TOOL-01 | Unknown tool | `BLOCKED · TOOL_UNKNOWN` | ⏳ P3 |
| TOOL-02 | Disabled tool | `BLOCKED · TOOL_DISABLED` | ⏳ P3 |
| TOOL-03 | Missing required parameter | `NEEDS_CLARIFICATION` listing missing fields (never guessed) | ⏳ P3 |
| TOOL-04 | Malformed / extra / wrong-type parameter | `BLOCKED · INVALID_PARAMETERS` (extra fields forbidden) | ⏳ P3 |
| TOOL-05 | DB tool without code simulator (or vice versa) | Startup/test failure | ⏳ P3 |

## ORD — order state (Phase 3)

| ID | Case | Expected behaviour | Test |
|---|---|---|---|
| ORD-01 | Unknown order | `BLOCKED · ORDER_NOT_FOUND` | ⏳ P3 |
| ORD-02 | Cancel already-cancelled order (ORD-10460) | `BLOCKED · ORDER_ALREADY_CANCELLED` | ⏳ P3 |
| ORD-03 | Refund already fully refunded payment | `BLOCKED · NOTHING_TO_REFUND` | ⏳ P3 |
| ORD-04 | Cancel delivered order (ORD-10477) | `BLOCKED · ORDER_NOT_CANCELLABLE` | ⏳ P3 |
| ORD-05 | Cancel shipped order (ORD-10501) | `BLOCKED · ORDER_NOT_CANCELLABLE` | ⏳ P3 |
| ORD-06 | Cancel COD order with no payment (ORD-10490) | Allowed; no Finance branch in graph | ⏳ P3 |
| ORD-07 | Duplicate proposal (same idempotency key) | Returns the existing action, no new row | ⏳ P6 |

## REF — refunds & money (Phase 3–4)

| ID | Case | Expected behaviour | Test |
|---|---|---|---|
| REF-01 | Zero amount | `BLOCKED · INVALID_AMOUNT` | ⏳ P3 |
| REF-02 | Negative amount | `BLOCKED · INVALID_AMOUNT` | ⏳ P3 |
| REF-03 | Amount > refundable remainder (ORD-10520: ₹10,000 left) | `BLOCKED · REFUND_EXCEEDS_REFUNDABLE` | ⏳ P3 |
| REF-04 | Exactly ₹2,000 | `AUTO_APPROVED` (limit is inclusive) | ⏳ P4 |
| REF-05 | ₹1,999.99 | `AUTO_APPROVED` | ⏳ P4 |
| REF-06 | ₹2,000.01 | `APPROVAL_REQUIRED · REFUND_ABOVE_AUTO_LIMIT` | ⏳ P4 |
| REF-07 | Full refund | payment → `REFUNDED` | ⏳ P3 |
| REF-08 | Partial refund | payment → `PARTIALLY_REFUNDED`, remainder correct to the paisa | ⏳ P3 |
| REF-09 | Duplicate refund in one cascade | Second node is a `DUPLICATE` edge, money counted once | ⏳ P3 |
| REF-10 | Sub-paisa amount (e.g. 0.005) | `BLOCKED · INVALID_AMOUNT` (max 2 decimal places) | ⏳ P3 |

## GRAPH — consequence traversal (Phase 3)

| ID | Case | Expected behaviour | Test |
|---|---|---|---|
| GRAPH-01 | No reactions fire | Single root node; Blast Radius has 0 downstream agents | ⏳ P3 |
| GRAPH-02 | One reaction | Two nodes, one `AGENT_REACTION` edge with rule id@version | ⏳ P3 |
| GRAPH-03 | Multiple reactions to one event | Children ordered by (priority, rule id) — deterministic | ⏳ P3 |
| GRAPH-04 | Same (agent, tool, params) reached twice | `DUPLICATE` edge; executed once | ⏳ P3 |
| GRAPH-05 | Cycle (A→B→A) | `CYCLE` edge; traversal terminates; reason recorded | ⏳ P3 |
| GRAPH-06 | Downstream agent disabled, rule required | Whole action `BLOCKED · DOWNSTREAM_AGENT_DISABLED` | ⏳ P3 |
| GRAPH-07 | Downstream agent disabled, rule optional | Node `BLOCKED`, action proceeds with warning | ⏳ P3 |
| GRAPH-08 | Downstream agent lacks permission for its tool | `BLOCKED · DOWNSTREAM_NOT_PERMITTED` on that node (required → whole action) | ⏳ P3 |
| GRAPH-09 | Downstream precondition fails | Node `WOULD_FAIL`; required → BLOCK, optional → warning | ⏳ P3 |
| GRAPH-10 | Depth or node limit hit | `CASCADE_LIMIT_REACHED`, risk floor ≥ HIGH | ⏳ P3 |
| GRAPH-11 | Same input twice | Byte-identical report and fingerprint | ⏳ P3 |
| GRAPH-12 | Simulation never writes to DB | Business tables unchanged after simulate | ⏳ P3 |

## APR — approval (Phase 6)

| ID | Case | Expected behaviour | Test |
|---|---|---|---|
| APR-01 | Approval required | `PENDING_APPROVAL`, approval request with expiry | ⏳ P6 |
| APR-02 | Rejected | `REJECTED`, terminal; execute → 409 | ⏳ P6 |
| APR-03 | Expired | `EXPIRED`, terminal; approve → 409 `APPROVAL_EXPIRED` | ⏳ P6 |
| APR-04 | Duplicate approval | Idempotent: second identical approve returns same result | ⏳ P6 |
| APR-05 | Approver lacks role (operator/viewer) | 403 `APPROVER_NOT_AUTHORIZED` | ⏳ P6 |
| APR-06 | Approver limit below money out (approver-dev, ₹10,000) | 403 `APPROVAL_LIMIT_EXCEEDED` | ⏳ P6 |
| APR-07 | Proposer approves own action | 403 `SELF_APPROVAL_FORBIDDEN` | ⏳ P6 |
| APR-08 | Approve already-executed action | 409 `ACTION_NOT_PENDING` | ⏳ P6 |

## EXE — execution (Phase 6/8)

| ID | Case | Expected behaviour | Test |
|---|---|---|---|
| EXE-01 | Required step fails | Everything rolled back; `FAILED`, retryable | ⏳ P8 |
| EXE-02 | Optional step fails (notification) | Rest kept; `PARTIALLY_EXECUTED`, failed step recorded | ⏳ P8 |
| EXE-03 | Retry after FAILED | New attempt row; re-simulated against fresh state | ⏳ P8 |
| EXE-04 | Duplicate execute request | Idempotent: returns existing execution, nothing applied twice | ⏳ P8 |
| EXE-05 | Execute without approval | 409 `APPROVAL_REQUIRED` | ⏳ P6 |
| EXE-06 | Applied changes equal previewed changes | Asserted field by field | ⏳ P6 |

## CON — concurrency (Phase 8)

| ID | Case | Expected behaviour | Test |
|---|---|---|---|
| CON-01 | Two actions on same order | First executes; second 409 `STALE_STATE` → `STALE` | ⏳ P8 |
| CON-02 | State changed between simulate and execute | 409 `STALE_STATE`; re-simulate offered | ⏳ P8 |
| CON-03 | Approved, then order changed, then execute | Same as CON-02 — approval does not bypass freshness | ⏳ P8 |

## SEC — security (Phase 5/6)

| ID | Case | Expected behaviour | Test |
|---|---|---|---|
| SEC-01 | Prompt injection in NL text | Text treated as data; validator decides; `INJECTION_SUSPECTED` audited | ⏳ P5 |
| SEC-02 | Text claims another agent identity | Ignored: identity comes from request only | ⏳ P5 |
| SEC-03 | LLM returns tool outside allowlist / invented tool | `LLM_OUTPUT_INVALID`, nothing created beyond audit | ⏳ P5 |
| SEC-04 | LLM returns extra/invalid params | Rejected by tool param model | ⏳ P5 |
| SEC-05 | LLM malformed JSON | Fail closed; no retry on invalid output | ⏳ P5 |
| SEC-06 | LLM explanation cites a number not in the report | Narrative discarded; deterministic template used | ⏳ P5 |
| SEC-07 | LLM timeout / 5xx / 429 | ≤1 retry, then controlled 503; structured flow unaffected | ⏳ P5 |
| SEC-08 | Unknown `X-User-Id` | 401 `USER_UNKNOWN` | ⏳ P6 |

## CLR — clarification (Phase 5)

| ID | Case | Expected behaviour | Test |
|---|---|---|---|
| CLR-01 | "Cancel the order" (no id) | `NEEDS_CLARIFICATION` asking for order id | ⏳ P5 |
| CLR-02 | "Refund John's order" (3 Johns) | Clarification listing candidates; never guesses | ⏳ P5 |
| CLR-03 | "Refund John Mathew's order" (3 orders) | Clarification listing his 3 orders | ⏳ P5 |
