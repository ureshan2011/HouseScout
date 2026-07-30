#!/usr/bin/env python3
"""Pre-generate the written analysis for every listing -> frontend/public/insights.json.

Each entry is grounded in that listing's real numbers (price, beds, land, and the
finance projection under the live-in-and-rent-rooms strategy) and laid out as
Verdict, Pros, Cons / red flags, Rent-a-room potential, Negotiation angle.

The prose is composed by backend/app/analysis.py — the same module the FastAPI
backend uses — so there is one implementation rather than a build-time copy that can
drift. Nothing here calls a language model; the static site loads insights.json and
renders it instantly, offline.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
PUBLIC_DIR = REPO_ROOT / "frontend" / "public"
LISTINGS = PUBLIC_DIR / "listings.json"
OUT = PUBLIC_DIR / "insights.json"

# ---- Finance engine (mirrors frontend/lib/finance.ts) --------------------- #
BOARDER_TAX_FREE_WEEKLY = 245.0
MAX_BOARDERS = 4
WEEKS = 52
MONTHS = 12
DEPOSIT = 50_000
RATE = 0.0519
TERM = 30


def monthly_payment(principal: float, annual_rate: float, term_years: int) -> float:
    if principal <= 0:
        return 0.0
    n = term_years * MONTHS
    r = annual_rate / MONTHS
    if r == 0:
        return principal / n
    return principal * r * (1 + r) ** n / ((1 + r) ** n - 1)


def amortise(principal: float, annual_rate: float, term_years: int, extra: float = 0.0):
    base = monthly_payment(principal, annual_rate, term_years)
    r = annual_rate / MONTHS
    bal = principal
    total_int = 0.0
    months = 0
    max_months = term_years * MONTHS + 1
    while bal > 0.005 and months < max_months * 2:
        interest = bal * r
        pay = base + extra
        principal_paid = pay - interest
        if principal_paid <= 0:
            return base, None, None
        if principal_paid > bal:
            principal_paid = bal
        bal -= principal_paid
        total_int += interest
        months += 1
    return base, round(months / 12, 1), round(total_int)


def rentable_rooms(bedrooms: int | None) -> int:
    if not bedrooms or bedrooms < 2:
        return 0
    return min(bedrooms - 1, MAX_BOARDERS)


def analyse(price: float, bedrooms: int | None, weekly_rent: float = 220.0):
    loan = max(price - DEPOSIT, 0.0)
    base_pmt, payoff_std, int_std = amortise(loan, RATE, TERM)
    rooms = rentable_rooms(bedrooms)
    weekly_gross = rooms * weekly_rent
    monthly_income = weekly_gross * WEEKS / MONTHS
    annual_rates = 3200.0
    annual_ins = 2200.0
    monthly_holding = (annual_rates + annual_ins + price * 0.01) / MONTHS
    surplus = max(monthly_income - monthly_holding, 0.0)
    _, payoff_acc, int_acc = amortise(loan, RATE, TERM, surplus)
    net_outlay = base_pmt + monthly_holding - monthly_income
    gross_yield = (weekly_gross * WEEKS / price) * 100 if price else 0.0
    years_saved = round(payoff_std - payoff_acc, 1) if (payoff_std and payoff_acc) else None
    interest_saved = (int_std - int_acc) if (int_std is not None and int_acc is not None) else None
    tax_free_weekly = min(weekly_rent, BOARDER_TAX_FREE_WEEKLY) * rooms
    return {
        "loan": round(loan),
        "monthly_payment": round(base_pmt),
        "rooms": rooms,
        "weekly_gross": round(weekly_gross),
        "monthly_income": round(monthly_income),
        "monthly_holding": round(monthly_holding),
        "net_outlay": round(net_outlay),
        "gross_yield": round(gross_yield, 1),
        "payoff_std": payoff_std,
        "payoff_acc": payoff_acc,
        "years_saved": years_saved,
        "interest_saved": interest_saved,
        "tax_free_weekly": round(tax_free_weekly),
    }


def money(n) -> str:
    if n is None:
        return "—"
    return f"${n:,.0f}"


# ---- Scoring engine (mirrors frontend/lib/scoring.ts) --------------------- #
MAX_PRICE = 500_000
WEIGHTS = {"price": 20, "garage": 10, "backyard": 15, "rentability": 30,
           "property_type": 10, "deal": 10, "freshness": 5}
PTYPE_SCORE = {"house": 1.0, "unit": 0.6, "apartment": 0.5, "townhouse": 0.45}


def clamp(x, lo=0.0, hi=1.0):
    return max(lo, min(hi, x))


def score_listing(l: dict) -> float:
    enr = l.get("enrichment") or {}
    price = l.get("price")
    comp = {}
    comp["price"] = clamp((MAX_PRICE - price) / max(MAX_PRICE - 250_000, 1)) if price else 0.3
    comp["garage"] = 1.0 if l.get("has_garage") else 0.0
    land = enr.get("land_area_m2") or l.get("land_area_m2")
    comp["backyard"] = clamp(0.4 + ((land - 50) / 550) * 0.6) if land else 0.2
    comp["rentability"] = clamp(rentable_rooms(l.get("bedrooms")) / 4)
    ptype = (l.get("property_type") or "house").lower()
    comp["property_type"] = PTYPE_SCORE.get(ptype, 0.5)
    ref = enr.get("estimate_value") or enr.get("rateable_value")
    comp["deal"] = clamp(0.5 + (ref - price) / ref) if (price and ref) else 0.5
    days = l.get("days_on_market")
    comp["freshness"] = clamp(1 - (days or 14) / 90)
    total = sum(WEIGHTS[k] * comp[k] for k in WEIGHTS)
    return round(total, 1)


# ---- Insight composition -------------------------------------------------- #
# The prose lives in backend/app/analysis.py so the FastAPI backend and this build
# script emit identical analysis from one implementation. That module is deliberately
# dependency-free so it imports cleanly here, where only Pillow is installed.
sys.path.insert(0, str(REPO_ROOT / "backend"))
from app.analysis import ENGINE_NAME, build_analysis  # noqa: E402


def build_insight(l: dict) -> str:
    fin = analyse(l.get("price") or 450_000, l.get("bedrooms"))
    return build_analysis(l, fin, l.get("_score"))


def main() -> None:
    if not LISTINGS.exists():
        print(f"! {LISTINGS} not found; run build_listings.py first")
        OUT.write_text("{}\n")
        return
    listings = json.loads(LISTINGS.read_text())
    insights = {}
    for l in listings:
        l["_score"] = score_listing(l)
        insights[str(l["id"])] = {
            "content": build_insight(l),
            "model": ENGINE_NAME,
        }
    OUT.write_text(json.dumps(insights, indent=2) + "\n")
    print(f"Wrote {len(insights)} AI insights to {OUT.name}")


if __name__ == "__main__":
    main()
