"""Deterministic explanation templates: the rules provider's narrative and the fallback whenever
an LLM narrative fails the numeric guard. Uses only numbers already in the facts."""

from __future__ import annotations

from decimal import Decimal

from app.domain.money import format_inr
from app.llm.schemas import ExplainInput, Explanation, OutcomeFacts

_DECISION = {
    "AUTO_APPROVED": "the agent may proceed without a human",
    "APPROVAL_REQUIRED": "a human approver must decide",
    "BLOCKED": "it is blocked and will not run",
}


def _inr(amount: str) -> str:
    return format_inr(Decimal(amount))


def _agents(facts: OutcomeFacts) -> str:
    if not facts.agents:
        return "no other agent"
    n = len(facts.agents)
    return f"{n} other agent{'s' if n != 1 else ''} ({', '.join(facts.agents)})"


def _cap(text: str) -> str:
    return text[:1].upper() + text[1:]


def _sentence(facts: OutcomeFacts) -> str:
    title = _cap(facts.title)
    if facts.decision == "BLOCKED":
        why = facts.reasons[0] if facts.reasons else "a hard rule failed"
        return f"{title} is blocked: {why}"
    money = (
        f"moves {_inr(facts.money_out)} out of NovaCart"
        if facts.money_out != "0.00"
        else ("moves no money")
    )
    return (
        f"{title} triggers {facts.downstream_actions} downstream "
        f"action{'s' if facts.downstream_actions != 1 else ''} across {_agents(facts)} "
        f"and {money}. "
        f"Risk is {facts.risk_level} ({facts.risk_score}/100), so {_DECISION[facts.decision]}."
    )


def template_explanation(data: ExplainInput) -> Explanation:
    base = data.base
    if data.kind == "comparison" and data.alternative is not None:
        alt = data.alternative
        lower = alt.risk_score < base.risk_score
        summary = (
            f"Instead of '{base.title}' ({_inr(base.money_out)}, risk {base.risk_score} "
            f"{base.risk_level}), '{alt.title}' moves {_inr(alt.money_out)} with risk "
            f"{alt.risk_score} {alt.risk_level} — {'lower' if lower else 'not lower'} risk."
        )
        bullets = [
            f"Downstream actions: {base.downstream_actions} → {alt.downstream_actions}.",
            f"Agents involved: {len(base.agents)} → {len(alt.agents)}.",
            f"Reversibility: {base.reversibility} → {alt.reversibility}.",
            f"Decision: {base.decision} → {alt.decision}.",
        ]
        return Explanation(summary=summary, bullets=bullets)
    bullets = list(base.reasons[:4]) + [
        f"{s.agent_id}: {s.summary}" for s in base.steps[1:4] if s.summary
    ]
    return Explanation(summary=_sentence(base), bullets=bullets[:8])
