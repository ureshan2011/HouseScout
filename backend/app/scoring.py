"""Matching & scoring engine — pure functions over plain dicts so they are testable
and decoupled from the ORM.

Encodes the buyer's brief:
  * Hard filters: price <= cap, garage required, backyard required.
  * Townhouses allowed but penalised.
  * Rentability (rooms for boarders) is heavily weighted (pay the loan off fast).
"""
from __future__ import annotations

from dataclasses import dataclass

from .finance import rentable_rooms


@dataclass
class Criteria:
    max_price: float = 500_000
    preapproval: float = 480_000
    require_garage: bool = True
    require_backyard: bool = True
    min_backyard_m2: float = 50.0  # "at least a tiny backyard"
    allow_townhouse: bool = True


# Component weights (sum = 100). Rentability dominates per the buyer's goal.
WEIGHTS = {
    "price": 20,
    "garage": 10,
    "backyard": 15,
    "rentability": 30,
    "property_type": 10,
    "deal": 10,
    "freshness": 5,
}

PROPERTY_TYPE_SCORE = {
    "house": 1.0,
    "unit": 0.6,
    "apartment": 0.5,
    "townhouse": 0.45,  # allowed but least preferred
}


def _backyard_m2(listing: dict) -> float | None:
    """Best available land figure (LINZ enrichment preferred over listing field)."""
    enr = listing.get("enrichment") or {}
    return enr.get("land_area_m2") or listing.get("land_area_m2")


def passes_hard_filters(listing: dict, c: Criteria) -> tuple[bool, list[str]]:
    """Return (passes, reasons_failed)."""
    reasons: list[str] = []
    price = listing.get("price")
    if price is not None and price > c.max_price:
        reasons.append(f"over budget (${price:,.0f} > ${c.max_price:,.0f})")
    if c.require_garage and not listing.get("has_garage"):
        reasons.append("no garage")
    if c.require_backyard:
        land = _backyard_m2(listing)
        ptype = (listing.get("property_type") or "").lower()
        # Apartments never have a yard; require land data to clear the filter otherwise.
        if ptype == "apartment" or (land is not None and land < c.min_backyard_m2):
            reasons.append("no/too-small backyard")
    if not c.allow_townhouse and (listing.get("property_type") or "").lower() == "townhouse":
        reasons.append("townhouse excluded")
    return (len(reasons) == 0, reasons)


def _clamp(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, x))


def score_listing(listing: dict, c: Criteria) -> dict:
    """Compute a 0-100 match score plus a component breakdown."""
    passes, failed = passes_hard_filters(listing, c)
    comp: dict[str, float] = {}

    # Price: reward headroom under pre-approval; 0 at/over cap.
    price = listing.get("price")
    if price:
        comp["price"] = _clamp((c.max_price - price) / max(c.max_price - 250_000, 1))
    else:
        comp["price"] = 0.3  # unknown (auction/negotiation) -> neutral-low

    comp["garage"] = 1.0 if listing.get("has_garage") else 0.0

    land = _backyard_m2(listing)
    if land:
        # Scale 50 m2 -> 0.4, 600 m2 -> 1.0.
        comp["backyard"] = _clamp(0.4 + (land - 50) / 550 * 0.6)
    else:
        comp["backyard"] = 0.2

    rooms = rentable_rooms(listing.get("bedrooms"))
    comp["rentability"] = _clamp(rooms / 4)  # 4 boarders = full IRD allowance

    ptype = (listing.get("property_type") or "house").lower()
    comp["property_type"] = PROPERTY_TYPE_SCORE.get(ptype, 0.5)

    # Deal: asking below estimate/RV is a good sign.
    enr = listing.get("enrichment") or {}
    ref = enr.get("estimate_value") or enr.get("rateable_value")
    if price and ref:
        comp["deal"] = _clamp(0.5 + (ref - price) / ref)
    else:
        comp["deal"] = 0.5

    # Freshness: newer listings score slightly higher (less competition lag handled elsewhere).
    days = listing.get("days_on_market")
    comp["freshness"] = _clamp(1 - (days or 14) / 90)

    total = sum(WEIGHTS[k] * comp[k] for k in WEIGHTS)
    return {
        "match_score": round(total, 1),
        "passes_filters": passes,
        "failed_filters": failed,
        "components": {k: round(comp[k], 3) for k in comp},
        "rentable_rooms": rooms,
    }
