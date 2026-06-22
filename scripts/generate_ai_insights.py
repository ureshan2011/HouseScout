#!/usr/bin/env python3
"""Pre-generate AI property analysis for every listing -> frontend/public/insights.json.

The static site has no backend and most users won't run a local LM model, so we
bake a high-quality, data-driven analysis for each listing at build time. Each
insight is grounded in that listing's real numbers (price, beds, land, finance
projections under the live-in-and-rent-rooms strategy) and written as the same
markdown structure the live model would produce: Verdict, Pros, Cons / red flags,
Rent-a-room potential, Negotiation angle.

The frontend loads insights.json and shows these instantly; if a user HAS a local
LM Studio endpoint configured, the app still offers a live "Refresh" that calls it.
"""
from __future__ import annotations

import json
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
def verdict(l: dict, fin: dict) -> str:
    score = l.get("_score")
    price = l.get("price") or 0
    rooms = fin["rooms"]
    if rooms >= 3 and price <= 480_000 and l.get("has_garage"):
        return "Strong buy for the boarder strategy — multiple rentable rooms, a garage, and room under budget."
    if rooms >= 2 and l.get("has_garage"):
        return "Solid contender — the spare rooms and garage make the live-in-and-rent maths work."
    if rooms <= 1:
        return "Marginal for the rent-rooms play — limited spare-room income, better as a low-cost owner-occupier."
    if not l.get("has_garage"):
        return "Worth a look, but the missing garage is a real drawback for resale and tenant appeal."
    return "Decent option; weigh the numbers below against fresher 4-bedroom stock."


def pros(l: dict, fin: dict) -> list[str]:
    out = []
    price = l.get("price")
    land = l.get("land_area_m2") or (l.get("enrichment") or {}).get("land_area_m2")
    beds = l.get("bedrooms")
    if price and price <= 450_000:
        out.append(f"Priced at {money(price)} — well under the $500k cap, leaving deposit headroom and equity buffer.")
    elif price:
        out.append(f"At {money(price)} it sits inside the $480k pre-approval ceiling.")
    if fin["rooms"] >= 3:
        out.append(f"{beds} bedrooms means up to {fin['rooms']} rooms to rent — near the IRD 4-boarder maximum for tax-free income.")
    elif fin["rooms"] == 2:
        out.append("Two spare rooms to rent — meaningful boarder income toward the mortgage.")
    if l.get("has_garage"):
        out.append("Has a garage — secure parking lifts both rentability and resale value.")
    if land and land >= 600:
        out.append(f"Generous {round(land)}m² section — backyard for tenants and potential future development.")
    elif land and land >= 400:
        out.append(f"{round(land)}m² section gives a usable backyard, comfortably clearing the 50m² minimum.")
    enr = l.get("enrichment") or {}
    if price and enr.get("estimate_value") and enr["estimate_value"] > price:
        gap = enr["estimate_value"] - price
        out.append(f"Asking is ~{money(gap)} below the estimated value of {money(enr['estimate_value'])} — possible built-in equity.")
    if fin["net_outlay"] <= 0:
        out.append(f"Boarder income fully covers the mortgage + holding costs ({money(-fin['net_outlay'])}/mo surplus).")
    if not out:
        out.append("Inside budget and meets the basic criteria for a first home.")
    return out


def cons(l: dict, fin: dict) -> list[str]:
    out = []
    land = l.get("land_area_m2") or (l.get("enrichment") or {}).get("land_area_m2")
    ptype = (l.get("property_type") or "house").lower()
    if not l.get("has_garage"):
        out.append("No garage listed — off-street parking only; a drawback for boarders with cars and for resale.")
    if fin["rooms"] <= 1:
        out.append("Only one (or zero) rentable room — limited boarder income, so the accelerated-payoff upside is small.")
    if ptype == "townhouse":
        out.append("Townhouse — body-corp fees and smaller land mean weaker capital growth than a standalone house.")
    elif ptype in ("unit", "apartment"):
        out.append(f"{ptype.title()} — typically no real backyard and shared title; confirm rules on subletting rooms.")
    if not land:
        out.append("Land area not confirmed in the listing — verify the section size and backyard before offering.")
    elif land < 250 and ptype == "house":
        out.append(f"Compact {round(land)}m² section — limited outdoor space and future development scope.")
    price_text = (l.get("price_text") or "").lower()
    if any(k in price_text for k in ("auction", "deadline", "negotiation", "poa", "enquir")):
        out.append(f"Marketed as '{l.get('price_text')}' — no fixed price, so research comparable sales before committing.")
    if fin["net_outlay"] > 400:
        out.append(f"Even with boarders you'd top up ~{money(fin['net_outlay'])}/mo — make sure that fits your budget.")
    if not out:
        out.append("No major red flags from the data — still get a builder's report and LIM before any offer.")
    return out


def rent_potential(l: dict, fin: dict) -> str:
    if fin["rooms"] == 0:
        return ("With no spare rooms to let, this works best as a low-cost owner-occupier rather than a "
                "boarder-income play. Your effective housing cost is the full "
                f"{money(fin['monthly_payment'])}/mo mortgage plus ~{money(fin['monthly_holding'])}/mo holding costs.")
    lines = [
        f"Renting {fin['rooms']} room(s) at $220/wk brings in about {money(fin['monthly_income'])}/mo "
        f"({money(fin['weekly_gross'])}/wk gross).",
        f"Up to {money(fin['tax_free_weekly'])}/wk of that is tax-free under the IRD standard-cost method.",
    ]
    if fin["net_outlay"] <= 0:
        lines.append(f"That more than covers the {money(fin['monthly_payment'])}/mo mortgage — you'd be "
                     f"~{money(-fin['net_outlay'])}/mo ahead before reinvesting.")
    else:
        lines.append(f"Against the {money(fin['monthly_payment'])}/mo mortgage you'd top up "
                     f"~{money(fin['net_outlay'])}/mo out of pocket.")
    if fin["years_saved"]:
        lines.append(f"Reinvesting the surplus pays the loan off in ~{fin['payoff_acc']} years vs "
                     f"{fin['payoff_std']} — about {fin['years_saved']} years sooner, saving "
                     f"~{money(fin['interest_saved'])} in interest.")
    lines.append(f"Gross yield on the room rents is ~{fin['gross_yield']}%.")
    return " ".join(lines)


def negotiation(l: dict, fin: dict) -> str:
    enr = l.get("enrichment") or {}
    price = l.get("price")
    bits = []
    pt = (l.get("price_text") or "").lower()
    if "auction" in pt:
        bits.append("It's going to auction, so set a hard ceiling from comparable sales and don't get drawn in — "
                    "have unconditional finance ready and consider a pre-auction offer to flush out the vendor's number.")
    elif "deadline" in pt:
        bits.append("Deadline sale: submit a clean, well-conditioned offer early — vendors sometimes engage before "
                    "the date if the offer is strong.")
    elif price:
        bits.append(f"There's a fixed/indicative price of {money(price)} — open below it and justify with comparable sales.")
    if enr.get("rateable_value") and price and price > enr["rateable_value"]:
        bits.append(f"Asking is above the RV of {money(enr['rateable_value'])}; use that gap as leverage.")
    elif enr.get("rateable_value") and price and price <= enr["rateable_value"]:
        bits.append(f"Asking is at/under the RV ({money(enr['rateable_value'])}) — reasonable, but still test for movement.")
    if not l.get("has_garage"):
        bits.append("Point to the missing garage as a value adjustment.")
    bits.append("Always make the offer conditional on a builder's report, LIM and finance unless you're at auction.")
    return " ".join(bits)


def build_insight(l: dict) -> str:
    fin = analyse(l.get("price") or 450_000, l.get("bedrooms"))
    score = l.get("_score")
    md = []
    md.append(f"**Verdict:** {verdict(l, fin)}")
    if score is not None:
        md.append(f"_HouseScout match score: {round(score)}/100._")
    md.append("\n**Pros**")
    md += [f"- {p}" for p in pros(l, fin)]
    md.append("\n**Cons / red flags**")
    md += [f"- {c}" for c in cons(l, fin)]
    md.append("\n**Rent-a-room potential**")
    md.append(rent_potential(l, fin))
    md.append("\n**Negotiation angle**")
    md.append(negotiation(l, fin))
    md.append("\n_Analysis generated from listing data and HouseScout's finance engine. "
              "Not financial advice — verify figures and seek professional guidance before buying._")
    return "\n".join(md)


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
            "model": "HouseScout AI",
        }
    OUT.write_text(json.dumps(insights, indent=2) + "\n")
    print(f"Wrote {len(insights)} AI insights to {OUT.name}")


if __name__ == "__main__":
    main()
