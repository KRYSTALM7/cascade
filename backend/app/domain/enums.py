"""Closed vocabularies shared by the ORM, the engines and the API. Pure: no framework imports.

DB columns typed with these enums get CHECK constraints, so an invalid value can never be stored.
"""

from __future__ import annotations

from enum import StrEnum

# --- Business state ---------------------------------------------------------------------------


class OrderStatus(StrEnum):
    PENDING = "PENDING"
    CONFIRMED = "CONFIRMED"
    SHIPPED = "SHIPPED"
    DELIVERED = "DELIVERED"
    CANCELLED = "CANCELLED"


class PaymentStatus(StrEnum):
    CAPTURED = "CAPTURED"
    PARTIALLY_REFUNDED = "PARTIALLY_REFUNDED"
    REFUNDED = "REFUNDED"
    REVERSED = "REVERSED"


class PaymentMethod(StrEnum):
    CARD = "CARD"
    UPI = "UPI"
    NETBANKING = "NETBANKING"
    COD = "COD"


class RefundKind(StrEnum):
    REFUND = "REFUND"
    COMPENSATION = "COMPENSATION"


class CustomerTier(StrEnum):
    STANDARD = "STANDARD"
    GOLD = "GOLD"
    VIP = "VIP"


class CustomerStatus(StrEnum):
    ACTIVE = "ACTIVE"
    AT_RISK = "AT_RISK"
    SUSPENDED = "SUSPENDED"


class CaseStatus(StrEnum):
    OPEN = "OPEN"
    RESOLVED = "RESOLVED"


class NotificationChannel(StrEnum):
    EMAIL = "EMAIL"
    SMS = "SMS"


# --- Tool characteristics (inputs to Blast Radius) ---------------------------------------------


class Reversibility(StrEnum):
    FULL = "FULL"
    PARTIAL = "PARTIAL"
    NONE = "NONE"


class ImpactLevel(StrEnum):
    NONE = "NONE"
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    SEVERE = "SEVERE"


class DataSensitivity(StrEnum):
    NONE = "NONE"
    INTERNAL = "INTERNAL"
    PII = "PII"
    BULK_PII = "BULK_PII"


# --- Multi-agent model -------------------------------------------------------------------------


class DomainEvent(StrEnum):
    """Facts a tool's simulated effect can emit. Agents subscribe to these via reaction rules."""

    ORDER_CANCELLED = "ORDER_CANCELLED"
    ORDER_MODIFIED = "ORDER_MODIFIED"
    ORDER_STATUS_CHANGED = "ORDER_STATUS_CHANGED"
    REFUND_REQUESTED = "REFUND_REQUESTED"
    REFUND_ISSUED = "REFUND_ISSUED"
    COMPENSATION_ISSUED = "COMPENSATION_ISSUED"
    PAYMENT_REVERSED = "PAYMENT_REVERSED"
    STOCK_RESERVED = "STOCK_RESERVED"
    STOCK_RELEASED = "STOCK_RELEASED"
    STOCK_BELOW_REORDER_POINT = "STOCK_BELOW_REORDER_POINT"
    CUSTOMER_STATUS_CHANGED = "CUSTOMER_STATUS_CHANGED"
    CASE_OPENED = "CASE_OPENED"


class ConditionKey(StrEnum):
    """Named, code-registered predicates gating a reaction (no string eval, ever)."""

    ALWAYS = "ALWAYS"
    PAYMENT_CAPTURED = "PAYMENT_CAPTURED"
    ORDER_HAS_RESERVED_STOCK = "ORDER_HAS_RESERVED_STOCK"
    CUSTOMER_IS_VIP = "CUSTOMER_IS_VIP"
    AMOUNT_AT_LEAST = "AMOUNT_AT_LEAST"  # condition_params: {"min_amount": "25000.00"}
    QUANTITY_INCREASED = "QUANTITY_INCREASED"
    QUANTITY_DECREASED = "QUANTITY_DECREASED"
    TOTAL_DECREASED = "TOTAL_DECREASED"


class TriggerType(StrEnum):
    ROOT = "ROOT"  # the proposed action itself
    AGENT_REACTION = "AGENT_REACTION"  # event -> subscribed agent -> reaction rule -> tool


# --- Governance --------------------------------------------------------------------------------


class UserRole(StrEnum):
    VIEWER = "VIEWER"
    OPERATOR = "OPERATOR"
    APPROVER = "APPROVER"


class ActionStatus(StrEnum):
    PARSED = "PARSED"
    NEEDS_CLARIFICATION = "NEEDS_CLARIFICATION"
    SIMULATED = "SIMULATED"
    BLOCKED = "BLOCKED"
    AUTO_APPROVED = "AUTO_APPROVED"
    PENDING_APPROVAL = "PENDING_APPROVAL"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    EXPIRED = "EXPIRED"
    STALE = "STALE"
    EXECUTING = "EXECUTING"
    EXECUTED = "EXECUTED"
    PARTIALLY_EXECUTED = "PARTIALLY_EXECUTED"
    FAILED = "FAILED"


class Decision(StrEnum):
    AUTO_APPROVED = "AUTO_APPROVED"
    APPROVAL_REQUIRED = "APPROVAL_REQUIRED"
    BLOCKED = "BLOCKED"


class RiskLevel(StrEnum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class ApprovalStatus(StrEnum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    EXPIRED = "EXPIRED"


class ExecutionStatus(StrEnum):
    RUNNING = "RUNNING"
    SUCCEEDED = "SUCCEEDED"
    PARTIAL = "PARTIAL"
    FAILED = "FAILED"


class ActorType(StrEnum):
    USER = "USER"
    AGENT = "AGENT"
    SYSTEM = "SYSTEM"
    LLM = "LLM"
