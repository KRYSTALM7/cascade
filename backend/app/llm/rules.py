"""Deterministic offline provider: regex/keyword parsing and template explanations.

Default provider, used by every test and as the demo safety net. It extracts only what is
literally in the text (ids, ₹ amounts, percentages, product words); it never guesses a missing
id — the backend's clarification rules ask instead.
"""

from __future__ import annotations

import re

from app.llm.provider import Narrative
from app.llm.schemas import (
    UNKNOWN_INTENT,
    ExplainInput,
    LLMIntent,
    LLMParameters,
    ParseContext,
    WhatIfContext,
)
from app.llm.templates import template_explanation

_ORDER = re.compile(r"\bORD-\d{3,8}\b", re.IGNORECASE)
_PAYMENT = re.compile(r"\bPAY-\d{3,8}\b", re.IGNORECASE)
_CUSTOMER = re.compile(r"\bCUST-\d{3,8}\b", re.IGNORECASE)
_AMOUNT = re.compile(r"(?:₹|\brs\.?|\binr)\s*([0-9][0-9,]*(?:\.[0-9]+)?)", re.IGNORECASE)
_PERCENT = re.compile(r"\b([0-9]+(?:\.[0-9]+)?)\s*(?:%|percent\b)", re.IGNORECASE)
_QUANTITY = re.compile(
    r"\b(?:to|quantity(?:\s+of)?|qty)\s+([0-9]{1,4})\b|\b([0-9]{1,4})\s*(?:units?|pcs|x)\b",
    re.IGNORECASE,
)
_POSSESSIVE = re.compile(r"\b([A-Z][a-z]+(?:\s+[A-Z][A-Za-z']+)?)'s\b")
_STOPWORDS = {
    "Customer",
    "Order",
    "The",
    "Today",
    "Finance",
    "Support",
    "Inventory",
    "What",
    "Please",
    "Refund",
    "Cancel",
    "Issue",
    "Change",
    "Modify",
    "Give",
    "Notify",
    "Reverse",
    "Compensate",
}
_STATUSES = {
    "confirm": "CONFIRMED",
    "ship": "SHIPPED",
    "dispatch": "SHIPPED",
    "deliver": "DELIVERED",
}

# (intent, pattern) checked in order; first match wins.
_INTENTS: list[tuple[str, re.Pattern[str]]] = [
    ("reverse_payment", re.compile(r"\breverse\b.*\bpayment|\bcharge-?back", re.I)),
    ("issue_compensation", re.compile(r"\bcompensat|\bgoodwill|\bcredit\b", re.I)),
    ("issue_refund", re.compile(r"\bissue\b.*\brefund", re.I)),
    ("cancel_order", re.compile(r"\bcancel(?!led)", re.I)),
    ("request_refund", re.compile(r"\brefund", re.I)),
    ("modify_order", re.compile(r"\b(?:modify|change|increase|decrease|reduce|make it)\b", re.I)),
    ("update_order_status", re.compile(r"\bmark\b.*\b(?:shipped|delivered|confirmed)\b", re.I)),
    ("release_inventory", re.compile(r"\brelease\b.*\b(?:stock|inventory)", re.I)),
    ("reserve_inventory", re.compile(r"\b(?:reserve|hold)\b.*\b(?:stock|inventory|units?)", re.I)),
    ("create_restock_request", re.compile(r"\brestock|\breplenish", re.I)),
    ("create_customer_case", re.compile(r"\b(?:open|create)\b.*\bcase\b|\bescalat", re.I)),
    ("send_customer_notification", re.compile(r"\bnotif|\bemail\b|\bsms\b|\btext the\b", re.I)),
    ("view_order", re.compile(r"\b(?:view|show|look up|check)\b", re.I)),
]


def _first(pattern: re.Pattern[str], text: str) -> str | None:
    match = pattern.search(text)
    return match.group(0).upper() if match else None


def _amount(text: str) -> str | None:
    match = _AMOUNT.search(text)
    return match.group(1).replace(",", "") if match else None


def _percentage(text: str) -> str | None:
    match = _PERCENT.search(text)
    return match.group(1) if match else None


def _quantity(text: str) -> int | None:
    match = _QUANTITY.search(text)
    if not match:
        return None
    return int(match.group(1) or match.group(2))


def _customer_name(text: str) -> str | None:
    for match in _POSSESSIVE.finditer(text):
        words = match.group(1).split()
        while words and words[0] in _STOPWORDS:  # "Refund John's" -> "John"
            words.pop(0)
        if words:
            return " ".join(words)
    return None


def _skus(text: str, products: dict[str, str]) -> list[str]:
    words = {w for w in re.findall(r"[a-z]{4,}", text.lower())}
    found = []
    for sku, name in sorted(products.items()):
        tokens = re.findall(r"[a-z]{4,}", name.lower())
        if any(w in t or t in w for w in words for t in tokens):
            found.append(sku)
    explicit = re.findall(r"\bSKU-[A-Z]{3}-\d{3}\b", text.upper())
    return sorted(set(found) | set(explicit))


def _intent(text: str, permitted: list[str]) -> str:
    for intent, pattern in _INTENTS:
        if pattern.search(text):
            # A plain "refund" from an agent that may only *request* refunds is a request.
            if intent == "request_refund" and "request_refund" not in permitted:
                return "issue_refund"
            return intent
    return UNKNOWN_INTENT


def _status(text: str) -> str | None:
    lowered = text.lower()
    for stem, status in _STATUSES.items():
        if stem in lowered:
            return status
    return None


def _template(text: str) -> str | None:
    match = re.search(
        r"\b(REFUND_ISSUED|ORDER_UPDATED|ORDER_CANCELLED|COMPENSATION_ISSUED|"
        r"ORDER_STATUS_UPDATED|ORDER_SHIPPED)\b",
        text.upper(),
    )
    if match:
        return match.group(1)
    return "ORDER_SHIPPED" if re.search(r"\bship", text, re.I) else None


def parse_text(text: str, permitted: list[str], products: dict[str, str]) -> LLMIntent:
    intent = _intent(text, permitted)
    ambiguities: list[str] = []
    params = LLMParameters()
    order_id = _first(_ORDER, text)
    if intent in {
        "cancel_order",
        "view_order",
        "request_refund",
        "issue_refund",
        "issue_compensation",
        "release_inventory",
        "update_order_status",
        "modify_order",
        "reserve_inventory",
        "send_customer_notification",
        "create_customer_case",
    }:
        params.order_id = order_id
        if order_id is None:
            params.customer_name = _customer_name(text)
    if intent in {"request_refund", "issue_refund", "issue_compensation"}:
        params.amount = _amount(text)
    if intent == "issue_compensation" and params.amount is None:
        params.percentage = _percentage(text)
    if intent == "reverse_payment":
        params.payment_id = _first(_PAYMENT, text)
    if intent in {"modify_order", "reserve_inventory", "create_restock_request"}:
        skus = _skus(text, products)
        if len(skus) > 1:
            ambiguities.append(f"Several products match: {', '.join(skus)}.")
        elif skus:
            params.sku = skus[0]
        params.quantity = _quantity(text)
    if intent == "update_order_status":
        params.status = _status(text)
    if intent in {"send_customer_notification", "create_customer_case"}:
        params.customer_id = _first(_CUSTOMER, text)
    if intent == "send_customer_notification":
        params.template = _template(text)
        params.channel = "SMS" if re.search(r"\bsms\b|\btext\b", text, re.I) else "EMAIL"
    if intent == "create_customer_case":
        params.reason = "CUSTOMER_REQUEST"
    confidence = 0.0 if intent == UNKNOWN_INTENT else (0.6 if ambiguities else 0.9)
    return LLMIntent(
        intent=intent, parameters=params, ambiguities=ambiguities, confidence=confidence
    )


class RulesProvider:
    name = "rules"

    def parse_intent(self, text: str, ctx: ParseContext) -> LLMIntent:
        return parse_text(text, ctx.permitted_tools, ctx.products)

    def interpret_what_if(self, text: str, ctx: WhatIfContext) -> LLMIntent:
        intent = parse_text(text, ctx.permitted_tools, ctx.products)
        base_order = ctx.base_params.get("order_id")
        if intent.parameters.order_id is None and isinstance(base_order, str):
            # "...instead" refers to the action being compared against.
            intent.parameters.order_id = base_order
            intent.parameters.customer_name = None
        return intent

    def explain(self, facts: ExplainInput) -> Narrative:
        return Narrative(template_explanation(facts), "rules")
