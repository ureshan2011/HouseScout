"""Prompt construction for per-listing insights, the chat assistant (RAG) and
mortgage/investment advice. All generation goes through ai.client (LM Studio)."""
from __future__ import annotations

import json

from . import client

SYSTEM_ADVISOR = (
    "You are HouseScout, a sharp, honest property buying co-pilot for Christchurch, "
    "New Zealand. The user wants to buy a home under NZ$500k (pre-approved to $480k), "
    "must have a garage and at least a small backyard, will live in it and rent spare "
    "rooms to boarders to pay the mortgage off as fast as possible. Townhouses are a "
    "last resort. Be concrete and numeric. Note NZ specifics: the IRD standard-cost "
    "method makes up to $245/week per boarder (max 4) effectively tax-free. You are not "
    "a licensed financial adviser; flag when professional/legal advice is warranted."
)


def listing_insight(listing: dict, finance: dict, score: dict) -> dict:
    """Generate pros/cons, red flags, rent-room suitability and a negotiation angle."""
    payload = {
        "listing": {
            k: listing.get(k)
            for k in (
                "address", "suburb", "price", "price_text", "bedrooms", "bathrooms",
                "has_garage", "land_area_m2", "property_type", "description",
            )
        },
        "match_score": score.get("match_score"),
        "score_components": score.get("components"),
        "finance": {
            "loan": finance.get("loan"),
            "monthly_payment": finance.get("monthly_payment"),
            "rentable_rooms": finance.get("boarder", {}).get("rentable_rooms"),
            "monthly_boarder_income": finance.get("monthly_boarder_income"),
            "net_monthly_outlay": finance.get("net_monthly_outlay"),
            "gross_yield_pct": finance.get("gross_yield_pct"),
            "payoff_years_standard": finance.get("standard", {}).get("payoff_years"),
            "payoff_years_accelerated": finance.get("accelerated", {}).get("payoff_years"),
            "years_saved": finance.get("years_saved"),
        },
    }
    messages = [
        {"role": "system", "content": SYSTEM_ADVISOR},
        {
            "role": "user",
            "content": (
                "Assess this property for my live-in-and-rent-rooms strategy. Use the data "
                "below. Respond in markdown with sections: **Verdict** (1 line), "
                "**Pros**, **Cons / red flags**, **Rent-a-room potential**, "
                "**Negotiation angle**. Be specific about the numbers.\n\n"
                + json.dumps(payload, default=str, indent=2)
            ),
        },
    ]
    return client.chat(messages, temperature=0.5)


def chat_assistant(question: str, context_listings: list[dict]) -> dict:
    """Answer a free-form question grounded in the supplied (already-retrieved) listings."""
    ctx = json.dumps(context_listings, default=str, indent=2)
    messages = [
        {"role": "system", "content": SYSTEM_ADVISOR},
        {
            "role": "user",
            "content": (
                f"Question: {question}\n\n"
                "Answer using ONLY the candidate listings below (they are the current "
                "matches in my database). Compare them, cite addresses, and recommend. "
                "If the data can't answer the question, say so.\n\n"
                f"Candidate listings:\n{ctx}"
            ),
        },
    ]
    return client.chat(messages, temperature=0.4, max_tokens=1100)


def advisor(question: str) -> dict:
    """General mortgage / loan / investment-strategy assistant (no listing context)."""
    messages = [
        {"role": "system", "content": SYSTEM_ADVISOR},
        {"role": "user", "content": question},
    ]
    return client.chat(messages, temperature=0.5, max_tokens=1100)
