"""NovaCart demo dataset — declarative, deterministic, and annotated with what each row is FOR.

Demo scenarios:
  HIGH    customer-support cancel_order ORD-10482 (₹84,500, VIP) -> Finance, Inventory, CRM
  MEDIUM  customer-support modify_order ORD-10495 (watch 1->2)  -> Inventory (+restock), CRM
  LOW     crm send_customer_notification for ORD-10501           -> no downstream
  BLOCKED customer-support issue_refund ORD-10482                -> agent lacks permission
  AUTO    customer-support cancel_order ORD-10510 (₹1,998)        -> refund under ₹2,000 limit
  WHAT-IF 20% compensation on ORD-10482 instead of cancelling    -> ₹16,900

Edge-case rows: completed order, already-cancelled+refunded order, shipped order, COD order with
no payment, partially-refunded payment, three "John"s for clarification, a low-limit approver.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from app.domain.enums import (
    ConditionKey,
    CustomerTier,
    DataSensitivity,
    DomainEvent,
    ImpactLevel,
    OrderStatus,
    PaymentMethod,
    PaymentStatus,
    Reversibility,
    UserRole,
)

D = Decimal
ZERO = D("0.00")

# --- Agents --------------------------------------------------------------------------------------

AGENTS: list[dict[str, Any]] = [
    {
        "id": "customer-support",
        "name": "Customer Support Agent",
        "description": "Handles customer conversations; proposes order changes and refunds.",
    },
    {
        "id": "order",
        "name": "Order Agent",
        "description": "Owns the order lifecycle: cancellation, modification, status.",
    },
    {
        "id": "finance",
        "name": "Finance Agent",
        "description": "Moves money: refunds, compensation, payment reversals.",
    },
    {
        "id": "inventory",
        "name": "Inventory Agent",
        "description": "Reserves and releases stock; raises restock requests.",
    },
    {
        "id": "crm",
        "name": "CRM Agent",
        "description": "Customer records, cases and notifications.",
    },
]

# --- Tools (owner = implementing agent; static risk characteristics) -----------------------------

R, Imp, S = Reversibility, ImpactLevel, DataSensitivity


def _tool(
    tool_id: str,
    owner: str,
    name: str,
    description: str,
    reversibility: Reversibility,
    impact: ImpactLevel,
    sensitivity: DataSensitivity,
    *,
    read_only: bool = False,
) -> dict[str, Any]:
    return {
        "id": tool_id,
        "owner_agent_id": owner,
        "name": name,
        "description": description,
        "reversibility": reversibility,
        "customer_impact": impact,
        "data_sensitivity": sensitivity,
        "read_only": read_only,
    }


TOOLS: list[dict[str, Any]] = [
    _tool(
        "view_order",
        "order",
        "View order",
        "Read an order.",
        R.FULL,
        Imp.NONE,
        S.PII,
        read_only=True,
    ),
    _tool(
        "cancel_order",
        "order",
        "Cancel order",
        "Cancel a pending/confirmed order.",
        R.NONE,
        Imp.HIGH,
        S.NONE,
    ),
    _tool(
        "modify_order",
        "order",
        "Modify order",
        "Change line quantities.",
        R.FULL,
        Imp.MEDIUM,
        S.NONE,
    ),
    _tool(
        "update_order_status",
        "order",
        "Update order status",
        "Advance fulfilment status.",
        R.PARTIAL,
        Imp.LOW,
        S.NONE,
    ),
    _tool(
        "request_refund",
        "customer-support",
        "Request refund",
        "Ask Finance to refund a captured payment.",
        R.FULL,
        Imp.LOW,
        S.NONE,
    ),
    _tool(
        "issue_refund",
        "finance",
        "Issue refund",
        "Return money to the customer.",
        R.NONE,
        Imp.MEDIUM,
        S.NONE,
    ),
    _tool(
        "issue_compensation",
        "finance",
        "Issue compensation",
        "Goodwill credit; the order stays active.",
        R.NONE,
        Imp.LOW,
        S.NONE,
    ),
    _tool(
        "reverse_payment",
        "finance",
        "Reverse payment",
        "Charge-back style full reversal.",
        R.NONE,
        Imp.HIGH,
        S.NONE,
    ),
    _tool(
        "reserve_inventory",
        "inventory",
        "Reserve inventory",
        "Hold stock for an order.",
        R.FULL,
        Imp.NONE,
        S.NONE,
    ),
    _tool(
        "release_inventory",
        "inventory",
        "Release inventory",
        "Return held stock to pool.",
        R.FULL,
        Imp.NONE,
        S.NONE,
    ),
    _tool(
        "create_restock_request",
        "inventory",
        "Create restock request",
        "Ask procurement to replenish a SKU.",
        R.PARTIAL,
        Imp.NONE,
        S.INTERNAL,
    ),
    _tool(
        "update_customer_status",
        "crm",
        "Update customer status",
        "Change a customer's lifecycle status.",
        R.FULL,
        Imp.LOW,
        S.INTERNAL,
    ),
    _tool(
        "create_customer_case",
        "crm",
        "Create customer case",
        "Open a CRM case.",
        R.PARTIAL,
        Imp.LOW,
        S.INTERNAL,
    ),
    _tool(
        "send_customer_notification",
        "crm",
        "Send notification",
        "Email/SMS the customer (uses contact PII).",
        R.NONE,
        Imp.LOW,
        S.PII,
    ),
]

# --- Permissions: which agent may CALL which tool (ownership does not imply permission) -----------

PERMISSIONS: dict[str, list[str]] = {
    # Deliberately NOT allowed issue_refund / reverse_payment -> the "unauthorized" demo.
    "customer-support": [
        "view_order",
        "cancel_order",
        "modify_order",
        "request_refund",
        "issue_compensation",
        "create_customer_case",
        "send_customer_notification",
    ],
    "order": ["view_order", "cancel_order", "modify_order", "update_order_status"],
    "finance": ["view_order", "issue_refund", "issue_compensation", "reverse_payment"],
    "inventory": ["view_order", "reserve_inventory", "release_inventory", "create_restock_request"],
    "crm": [
        "view_order",
        "update_customer_status",
        "create_customer_case",
        "send_customer_notification",
    ],
}

# --- Reaction rules: declared multi-agent behaviour ----------------------------------------------

E, C = DomainEvent, ConditionKey


@dataclass(frozen=True)
class ReactionSeed:
    id: str
    agent_id: str
    event_type: DomainEvent
    tool_id: str
    param_mapping: dict[str, Any]
    condition_key: ConditionKey = ConditionKey.ALWAYS
    condition_params: dict[str, Any] = field(default_factory=dict)
    required: bool = True
    priority: int = 100
    description: str = ""
    enabled: bool = True


REACTIONS: list[ReactionSeed] = [
    # Order cancelled
    ReactionSeed(
        "finance.refund_on_cancel",
        "finance",
        E.ORDER_CANCELLED,
        "issue_refund",
        {
            "order_id": "$event.order_id",
            "amount": "$event.refundable_amount",
            "reason": "ORDER_CANCELLED",
        },
        C.PAYMENT_CAPTURED,
        priority=10,
        description="Finance refunds captured payments of a cancelled order.",
    ),
    ReactionSeed(
        "inventory.release_on_cancel",
        "inventory",
        E.ORDER_CANCELLED,
        "release_inventory",
        {"order_id": "$event.order_id"},
        C.ORDER_HAS_RESERVED_STOCK,
        priority=20,
        description="Inventory returns stock held for a cancelled order.",
    ),
    ReactionSeed(
        "crm.flag_vip_on_cancel",
        "crm",
        E.ORDER_CANCELLED,
        "update_customer_status",
        {"customer_id": "$event.customer_id", "status": "AT_RISK", "reason": "VIP_ORDER_CANCELLED"},
        C.CUSTOMER_IS_VIP,
        required=False,
        priority=30,
        description="CRM flags VIP customers as churn risk when they cancel.",
    ),
    # Refunds
    ReactionSeed(
        "crm.notify_on_refund",
        "crm",
        E.REFUND_ISSUED,
        "send_customer_notification",
        {
            "customer_id": "$event.customer_id",
            "order_id": "$event.order_id",
            "template": "REFUND_ISSUED",
            "channel": "EMAIL",
        },
        required=False,
        priority=40,
        description="CRM emails the customer about their refund.",
    ),
    ReactionSeed(
        "crm.case_on_large_refund",
        "crm",
        E.REFUND_ISSUED,
        "create_customer_case",
        {
            "customer_id": "$event.customer_id",
            "order_id": "$event.order_id",
            "reason": "HIGH_VALUE_REFUND",
        },
        C.AMOUNT_AT_LEAST,
        {"min_amount": "25000.00"},
        required=False,
        priority=50,
        description="CRM opens a review case for refunds of ₹25,000 or more.",
    ),
    ReactionSeed(
        "finance.refund_on_request",
        "finance",
        E.REFUND_REQUESTED,
        "issue_refund",
        {"order_id": "$event.order_id", "amount": "$event.amount", "reason": "CUSTOMER_REQUEST"},
        C.PAYMENT_CAPTURED,
        priority=10,
        description="Finance fulfils refund requests raised by Support.",
    ),
    # Order modified
    ReactionSeed(
        "inventory.reserve_on_modify",
        "inventory",
        E.ORDER_MODIFIED,
        "reserve_inventory",
        {"order_id": "$event.order_id", "lines": "$event.increased_lines"},
        C.QUANTITY_INCREASED,
        priority=10,
        description="Inventory holds stock for added quantities.",
    ),
    ReactionSeed(
        "inventory.release_on_modify",
        "inventory",
        E.ORDER_MODIFIED,
        "release_inventory",
        {"order_id": "$event.order_id", "lines": "$event.decreased_lines"},
        C.QUANTITY_DECREASED,
        priority=20,
        description="Inventory releases stock for removed quantities.",
    ),
    ReactionSeed(
        "finance.refund_on_downsize",
        "finance",
        E.ORDER_MODIFIED,
        "issue_refund",
        {
            "order_id": "$event.order_id",
            "amount": "$event.total_decrease",
            "reason": "ORDER_MODIFIED",
        },
        C.TOTAL_DECREASED,
        priority=30,
        description="Finance refunds the difference when an order gets cheaper.",
    ),
    ReactionSeed(
        "crm.notify_on_modify",
        "crm",
        E.ORDER_MODIFIED,
        "send_customer_notification",
        {
            "customer_id": "$event.customer_id",
            "order_id": "$event.order_id",
            "template": "ORDER_UPDATED",
            "channel": "EMAIL",
        },
        required=False,
        priority=40,
        description="CRM tells the customer their order changed.",
    ),
    ReactionSeed(
        "inventory.restock_on_low_stock",
        "inventory",
        E.STOCK_BELOW_REORDER_POINT,
        "create_restock_request",
        {"sku": "$event.sku", "quantity": "$event.suggested_quantity"},
        required=False,
        priority=10,
        description="Inventory requests replenishment when stock dips below reorder point.",
    ),
    # Other money / status events
    ReactionSeed(
        "crm.notify_on_compensation",
        "crm",
        E.COMPENSATION_ISSUED,
        "send_customer_notification",
        {
            "customer_id": "$event.customer_id",
            "order_id": "$event.order_id",
            "template": "COMPENSATION_ISSUED",
            "channel": "EMAIL",
        },
        required=False,
        priority=10,
        description="CRM tells the customer about their goodwill credit.",
    ),
    ReactionSeed(
        "crm.notify_on_status_change",
        "crm",
        E.ORDER_STATUS_CHANGED,
        "send_customer_notification",
        {
            "customer_id": "$event.customer_id",
            "order_id": "$event.order_id",
            "template": "ORDER_STATUS_UPDATED",
            "channel": "SMS",
        },
        required=False,
        priority=10,
        description="CRM texts the customer on fulfilment updates.",
    ),
    ReactionSeed(
        "crm.case_on_reversal",
        "crm",
        E.PAYMENT_REVERSED,
        "create_customer_case",
        {
            "customer_id": "$event.customer_id",
            "order_id": "$event.order_id",
            "reason": "PAYMENT_REVERSED",
        },
        required=False,
        priority=10,
        description="CRM opens a case whenever a payment is reversed.",
    ),
    # Escape Room "unauthorized downstream": CRM is NOT permitted to issue compensation. Seeded
    # DISABLED so it never affects the demo; the scenario enables it for one simulation.
    ReactionSeed(
        "crm.goodwill_on_vip_cancel",
        "crm",
        E.ORDER_CANCELLED,
        "issue_compensation",
        {"order_id": "$event.order_id", "percentage": "10", "reason": "VIP_GOODWILL"},
        C.CUSTOMER_IS_VIP,
        priority=60,
        description="(Escape Room) CRM tries to grant VIP goodwill credit it is not allowed to.",
        enabled=False,
    ),
]

# --- Humans ---------------------------------------------------------------------------------------

USERS: list[dict[str, Any]] = [
    {
        "id": "ops-ravi",
        "name": "Ravi Kumar (Support Ops)",
        "role": UserRole.OPERATOR,
        "approval_limit": None,
    },
    {
        "id": "approver-asha",
        "name": "Asha Menon (Finance Lead)",
        "role": UserRole.APPROVER,
        "approval_limit": D("100000.00"),
    },
    {
        "id": "approver-dev",
        "name": "Dev Patel (Team Lead)",
        "role": UserRole.APPROVER,
        "approval_limit": D("10000.00"),
    },  # too low for the ₹84,500 refund -> approver edge case
    {
        "id": "viewer-kim",
        "name": "Kim Lee (Auditor)",
        "role": UserRole.VIEWER,
        "approval_limit": None,
    },
]

# --- Customers ------------------------------------------------------------------------------------

CUSTOMERS: list[dict[str, Any]] = [
    {
        "id": "CUST-1001",
        "name": "John Mathew",
        "email": "john.mathew@example.com",
        "phone": "+91-98450-11001",
        "tier": CustomerTier.VIP,
    },
    {
        "id": "CUST-1002",
        "name": "John Fernandes",
        "email": "john.f@example.com",
        "phone": "+91-98450-11002",
        "tier": CustomerTier.STANDARD,
    },
    {
        "id": "CUST-1003",
        "name": "John D'Souza",
        "email": "jdsouza@example.com",
        "phone": "+91-98450-11003",
        "tier": CustomerTier.GOLD,
    },
    {
        "id": "CUST-1004",
        "name": "Priya Raman",
        "email": "priya.raman@example.com",
        "phone": "+91-98450-11004",
        "tier": CustomerTier.GOLD,
    },
    {
        "id": "CUST-1005",
        "name": "Arjun Mehta",
        "email": "arjun.mehta@example.com",
        "phone": "+91-98450-11005",
        "tier": CustomerTier.STANDARD,
    },
    {
        "id": "CUST-1006",
        "name": "Ananya Iyer",
        "email": "ananya.iyer@example.com",
        "phone": "+91-98450-11006",
        "tier": CustomerTier.STANDARD,
    },
    {
        "id": "CUST-1007",
        "name": "Rahul Verma",
        "email": "rahul.verma@example.com",
        "phone": "+91-98450-11007",
        "tier": CustomerTier.GOLD,
    },
    {
        "id": "CUST-1008",
        "name": "Meera Nair",
        "email": "meera.nair@example.com",
        "phone": "+91-98450-11008",
        "tier": CustomerTier.STANDARD,
    },
]

# --- Inventory (on_hand is physical stock; `reserved` is derived from open orders at seed time) ---

INVENTORY: list[dict[str, Any]] = [
    {
        "sku": "SKU-LAP-001",
        "name": "NovaBook Pro 14 Laptop",
        "on_hand": 12,
        "reorder_point": 5,
        "unit_price": D("72000.00"),
    },
    {
        "sku": "SKU-HPH-002",
        "name": "Aurora ANC Headphones",
        "on_hand": 40,
        "reorder_point": 10,
        "unit_price": D("12500.00"),
    },
    # 9 on hand, 1 held by ORD-10495, reorder at 8: one more reservation tips it below.
    {
        "sku": "SKU-WAT-003",
        "name": "Pulse Smartwatch",
        "on_hand": 9,
        "reorder_point": 8,
        "unit_price": D("8999.00"),
    },
    {
        "sku": "SKU-CBL-004",
        "name": "USB-C Cable 2m",
        "on_hand": 300,
        "reorder_point": 50,
        "unit_price": D("499.00"),
    },
    {
        "sku": "SKU-MOU-005",
        "name": "Glide Wireless Mouse",
        "on_hand": 60,
        "reorder_point": 15,
        "unit_price": D("1499.00"),
    },
    {
        "sku": "SKU-PHN-006",
        "name": "Nova X2 Phone",
        "on_hand": 8,
        "reorder_point": 4,
        "unit_price": D("54999.00"),
    },
    {
        "sku": "SKU-BAG-007",
        "name": "Commuter Backpack",
        "on_hand": 25,
        "reorder_point": 5,
        "unit_price": D("2999.00"),
    },
]


# --- Orders ---------------------------------------------------------------------------------------


@dataclass(frozen=True)
class PaymentSeed:
    id: str
    method: PaymentMethod
    status: PaymentStatus = PaymentStatus.CAPTURED
    refunded_amount: Decimal = ZERO


@dataclass(frozen=True)
class OrderSeed:
    id: str
    customer_id: str
    status: OrderStatus
    lines: list[tuple[str, int]]  # (sku, quantity); unit price taken from inventory
    payment: PaymentSeed | None
    note: str = ""


OPEN_STATUSES = frozenset({OrderStatus.PENDING, OrderStatus.CONFIRMED})

ORDERS: list[OrderSeed] = [
    OrderSeed(
        "ORD-10482",
        "CUST-1001",
        OrderStatus.CONFIRMED,
        [("SKU-LAP-001", 1), ("SKU-HPH-002", 1)],
        PaymentSeed("PAY-90482", PaymentMethod.CARD),
        "HERO: ₹84,500 VIP order. Cancel -> 3 downstream agents, HIGH risk.",
    ),
    OrderSeed(
        "ORD-10477",
        "CUST-1001",
        OrderStatus.DELIVERED,
        [("SKU-MOU-005", 1)],
        PaymentSeed("PAY-90477", PaymentMethod.UPI),
        "Completed order: cancel must be rejected.",
    ),
    OrderSeed(
        "ORD-10490",
        "CUST-1001",
        OrderStatus.PENDING,
        [("SKU-BAG-007", 1)],
        None,
        "Cash-on-delivery, nothing captured: cancel has no Finance branch.",
    ),
    OrderSeed(
        "ORD-10495",
        "CUST-1004",
        OrderStatus.CONFIRMED,
        [("SKU-WAT-003", 1), ("SKU-CBL-004", 2)],
        PaymentSeed("PAY-90495", PaymentMethod.CARD),
        "MEDIUM: modify watch 1->2 -> reserve -> below reorder point -> restock + notify.",
    ),
    OrderSeed(
        "ORD-10501",
        "CUST-1005",
        OrderStatus.SHIPPED,
        [("SKU-PHN-006", 1)],
        PaymentSeed("PAY-90501", PaymentMethod.UPI),
        "LOW: shipping notification. Also: shipped orders cannot be cancelled.",
    ),
    OrderSeed(
        "ORD-10460",
        "CUST-1006",
        OrderStatus.CANCELLED,
        [("SKU-HPH-002", 1)],
        PaymentSeed("PAY-90460", PaymentMethod.CARD, PaymentStatus.REFUNDED, D("12500.00")),
        "Already cancelled and fully refunded: duplicate cancel/refund cases.",
    ),
    OrderSeed(
        "ORD-10510",
        "CUST-1007",
        OrderStatus.CONFIRMED,
        [("SKU-MOU-005", 1), ("SKU-CBL-004", 1)],
        PaymentSeed("PAY-90510", PaymentMethod.UPI),
        "₹1,998 cancel: refund under ₹2,000 auto-approve limit.",
    ),
    OrderSeed(
        "ORD-10520",
        "CUST-1002",
        OrderStatus.CONFIRMED,
        [("SKU-HPH-002", 1)],
        PaymentSeed(
            "PAY-90520", PaymentMethod.CARD, PaymentStatus.PARTIALLY_REFUNDED, D("2500.00")
        ),
        "Partially refunded already: only ₹10,000 remains refundable.",
    ),
    OrderSeed(
        "ORD-10530",
        "CUST-1003",
        OrderStatus.CONFIRMED,
        [("SKU-PHN-006", 1)],
        PaymentSeed("PAY-90530", PaymentMethod.NETBANKING),
        "Third John: makes 'cancel John's order' ambiguous across customers.",
    ),
    OrderSeed(
        "ORD-10540",
        "CUST-1008",
        OrderStatus.CONFIRMED,
        [("SKU-LAP-001", 1)],
        PaymentSeed("PAY-90540", PaymentMethod.CARD),
        "Second high-value order for concurrency/race demos.",
    ),
]
