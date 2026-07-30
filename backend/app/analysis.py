"""Deterministic property analysis — the engine that replaced the LM Studio proxy.

HouseScout used to send listing data to a local LM Studio (Gemma) server to write
its per-listing assessments and answer questions. That is gone. It only ever worked
for one person on one machine with a GPU, an HTTPS site calling http://localhost is
blocked outright by some browsers, and no subscriber could depend on it.

Everything here is computed from the listing's own numbers and a Christchurch buyer
knowledge base. That trade is a clear win for a product: it is free, instant,
offline, identical for every user, and — most importantly — every sentence traces
back to a figure we can show, so it cannot invent a fact about someone's largest
purchase.

Pure standard library on purpose: this module is imported both by the FastAPI
backend and by ``scripts/generate_ai_insights.py`` during the static site build,
where only Pillow is installed. Keep it dependency-free.
"""
from __future__ import annotations

# IRD standard-cost method (2025-26): up to this much per boarder, max 4, is tax-free.
BOARDER_TAX_FREE_WEEKLY = 245.0
MAX_BOARDERS = 4

ENGINE_NAME = "HouseScout engine"


def money(n: float | int | None) -> str:
    return "—" if n is None else f"${n:,.0f}"


def _land_of(l: dict) -> float | None:
    return l.get("land_area_m2") or (l.get("enrichment") or {}).get("land_area_m2")


# --------------------------------------------------------------------------- #
# Per-listing written analysis
# --------------------------------------------------------------------------- #
def verdict(l: dict, fin: dict) -> str:
    price = l.get("price") or 0
    rooms = fin["rooms"]
    if rooms >= 3 and price <= 480_000 and l.get("has_garage"):
        return (
            "Strong buy for the boarder strategy — multiple rentable rooms, a garage, "
            "and room under budget."
        )
    if rooms >= 2 and l.get("has_garage"):
        return "Solid contender — the spare rooms and garage make the live-in-and-rent maths work."
    if rooms <= 1:
        return (
            "Marginal for the rent-rooms play — limited spare-room income, better as a "
            "low-cost owner-occupier."
        )
    if not l.get("has_garage"):
        return (
            "Worth a look, but the missing garage is a real drawback for resale and "
            "tenant appeal."
        )
    return "Decent option; weigh the numbers below against fresher 4-bedroom stock."


def pros(l: dict, fin: dict) -> list[str]:
    out: list[str] = []
    price = l.get("price")
    land = _land_of(l)
    beds = l.get("bedrooms")
    estimated_price = (l.get("provenance") or {}).get("price") == "modelled"

    if price and price <= 450_000:
        out.append(
            f"{'Estimated at' if estimated_price else 'Priced at'} {money(price)} — well under "
            "the $500k cap, leaving deposit headroom and equity buffer."
        )
    elif price:
        out.append(f"At {money(price)} it sits inside the $480k pre-approval ceiling.")
    if fin["rooms"] >= 3:
        out.append(
            f"{beds} bedrooms means up to {fin['rooms']} rooms to rent — near the IRD "
            "4-boarder maximum for tax-free income."
        )
    elif fin["rooms"] == 2:
        out.append("Two spare rooms to rent — meaningful boarder income toward the mortgage.")
    if l.get("has_garage"):
        out.append("Has a garage — secure parking lifts both rentability and resale value.")
    if land and land >= 600:
        out.append(
            f"Generous {round(land)}m² section — backyard for tenants and potential future "
            "development."
        )
    elif land and land >= 400:
        out.append(
            f"{round(land)}m² section gives a usable backyard, comfortably clearing the "
            "50m² minimum."
        )
    if fin["net_outlay"] <= 0:
        out.append(
            "Boarder income fully covers the mortgage + holding costs "
            f"({money(-fin['net_outlay'])}/mo surplus)."
        )
    if not out:
        out.append("Inside budget and meets the basic criteria for a first home.")
    return out


def cons(l: dict, fin: dict) -> list[str]:
    out: list[str] = []
    land = _land_of(l)
    ptype = (l.get("property_type") or "house").lower()

    if not l.get("has_garage"):
        out.append(
            "No garage listed — off-street parking only; a drawback for boarders with cars "
            "and for resale."
        )
    if fin["rooms"] <= 1:
        out.append(
            "Only one (or zero) rentable room — limited boarder income, so the "
            "accelerated-payoff upside is small."
        )
    if ptype == "townhouse":
        out.append(
            "Townhouse — body-corp fees and smaller land mean weaker capital growth than a "
            "standalone house."
        )
    elif ptype in ("unit", "apartment"):
        out.append(
            f"{ptype.title()} — typically no real backyard and shared title; confirm rules "
            "on subletting rooms."
        )
    if not land:
        out.append(
            "Land area not confirmed in the listing — verify the section size and backyard "
            "before offering."
        )
    elif land < 250 and ptype == "house":
        out.append(
            f"Compact {round(land)}m² section — limited outdoor space and future development scope."
        )

    # Be explicit when the headline price is ours rather than the vendor's.
    if (l.get("provenance") or {}).get("price") == "modelled":
        out.append(
            f"Marketed as '{l.get('price_text') or 'no price given'}' — the figure above is "
            "HouseScout's estimate, not an asking price. Research comparable sales before "
            "committing."
        )
    if fin["net_outlay"] > 400:
        out.append(
            f"Even with boarders you'd top up ~{money(fin['net_outlay'])}/mo — make sure that "
            "fits your budget."
        )
    if not out:
        out.append(
            "No major red flags from the data — still get a builder's report and LIM before "
            "any offer."
        )
    return out


def rent_potential(l: dict, fin: dict, weekly_rent: float = 220.0) -> str:
    if fin["rooms"] == 0:
        return (
            "With no spare rooms to let, this works best as a low-cost owner-occupier rather "
            "than a boarder-income play. Your effective housing cost is the full "
            f"{money(fin['monthly_payment'])}/mo mortgage plus "
            f"~{money(fin['monthly_holding'])}/mo holding costs."
        )
    lines = [
        f"Renting {fin['rooms']} room(s) at ${weekly_rent:,.0f}/wk brings in about "
        f"{money(fin['monthly_income'])}/mo ({money(fin['weekly_gross'])}/wk gross).",
        f"Up to {money(fin['tax_free_weekly'])}/wk of that is tax-free under the IRD "
        "standard-cost method.",
    ]
    if fin["net_outlay"] <= 0:
        lines.append(
            f"That more than covers the {money(fin['monthly_payment'])}/mo mortgage — you'd be "
            f"~{money(-fin['net_outlay'])}/mo ahead before reinvesting."
        )
    else:
        lines.append(
            f"Against the {money(fin['monthly_payment'])}/mo mortgage you'd top up "
            f"~{money(fin['net_outlay'])}/mo out of pocket."
        )
    if fin.get("years_saved"):
        lines.append(
            f"Reinvesting the surplus pays the loan off in ~{fin['payoff_acc']} years vs "
            f"{fin['payoff_std']} — about {fin['years_saved']} years sooner, saving "
            f"~{money(fin['interest_saved'])} in interest."
        )
    lines.append(f"Gross yield on the room rents is ~{fin['gross_yield']}%.")
    return " ".join(lines)


def negotiation(l: dict, fin: dict) -> str:
    price = l.get("price")
    text = (l.get("price_text") or "").lower()
    bits: list[str] = []

    if "auction" in text:
        bits.append(
            "It's going to auction, so set a hard ceiling from comparable sales and don't get "
            "drawn in — have unconditional finance ready and consider a pre-auction offer to "
            "flush out the vendor's number."
        )
    elif "deadline" in text:
        bits.append(
            "Deadline sale: submit a clean, well-conditioned offer early — vendors sometimes "
            "engage before the date if the offer is strong."
        )
    elif price and (l.get("provenance") or {}).get("price") == "observed":
        bits.append(
            f"There's a published price of {money(price)} — open below it and justify with "
            "comparable sales."
        )
    else:
        bits.append(
            "No price is published, so your first job is to establish the vendor's expectation "
            "from recent comparable sales in the same suburb."
        )

    if not l.get("has_garage"):
        bits.append("Point to the missing garage as a value adjustment.")
    bits.append(
        "Always make the offer conditional on a builder's report, LIM and finance unless "
        "you're at auction."
    )
    return " ".join(bits)


def build_analysis(l: dict, fin: dict, match_score: float | None = None) -> str:
    """Compose the markdown analysis for one listing.

    ``fin`` is the finance summary produced by ``finance_summary`` (or the equivalent
    dict from the build script), so this function stays free of finance maths.
    """
    md = [f"**Verdict:** {verdict(l, fin)}"]
    if match_score is not None:
        md.append(f"_HouseScout match score: {round(match_score)}/100._")
    md.append("\n**Pros**")
    md += [f"- {p}" for p in pros(l, fin)]
    md.append("\n**Cons / red flags**")
    md += [f"- {c}" for c in cons(l, fin)]
    md.append("\n**Rent-a-room potential**")
    md.append(rent_potential(l, fin))
    md.append("\n**Negotiation angle**")
    md.append(negotiation(l, fin))
    md.append(
        "\n_Computed from this listing's data and HouseScout's finance engine. "
        "Not financial advice — verify figures and seek professional guidance before buying._"
    )
    return "\n".join(md)


# --------------------------------------------------------------------------- #
# Question answering, grounded in the supplied listings
# --------------------------------------------------------------------------- #
def _line(r: dict) -> str:
    return (
        f"**{r.get('address') or 'Unknown'}** ({r.get('suburb') or '—'}) — "
        f"{money(r.get('price'))}, {r.get('bedrooms') or '?'} bed, "
        f"{r.get('rentable_rooms') or 0} room(s) to rent, "
        f"score {round(r.get('match_score') or 0)}/100."
    )


def answer_about_listings(question: str, rows: list[dict]) -> dict:
    """Rank and compare the supplied listings to answer a question about them."""
    if not rows:
        return {
            "ok": True,
            "content": (
                "I don't have any matching listings loaded yet. Try loosening the filters on "
                "the Listings page, then ask again."
            ),
            "model": ENGINE_NAME,
        }

    q = question.lower()

    def by(key: str, reverse: bool = True) -> list[dict]:
        return sorted(rows, key=lambda r: r.get(key) or 0, reverse=reverse)

    if any(k in q for k in ("pay off", "payoff", "fastest", "quickest", "sooner", "accelerat")):
        picks = sorted(rows, key=lambda r: r.get("payoff_years_accelerated") or 99)[:4]
        extra = " ".join(
            f"{p.get('address')}: ~{p.get('payoff_years_accelerated') or '—'} yrs "
            f"(net {money(p.get('net_monthly_outlay'))}/mo)."
            for p in picks
        )
        body = "\n".join(_line(p) for p in picks)
        return {
            "ok": True,
            "content": "Ranked by how fast the mortgage clears when you reinvest boarder "
            f"income:\n\n{body}\n\n{extra}",
            "model": ENGINE_NAME,
        }

    if any(k in q for k in ("boarder", "most rooms", "rent rooms", "four bed", "4 bed")):
        intro = "Best for boarder income (most rentable rooms, then score):"
        picks = sorted(
            rows,
            key=lambda r: (r.get("rentable_rooms") or 0, r.get("match_score") or 0),
            reverse=True,
        )[:4]
    elif any(k in q for k in ("cheap", "afford", "lowest", "budget", "least")):
        intro = "Lowest-priced matches:"
        picks = by("price", reverse=False)[:4]
    elif any(k in q for k in ("yield", "return", "cashflow", "income")):
        intro = "Highest gross rental yield:"
        picks = by("gross_yield_pct")[:4]
    else:
        intro = "Top matches by overall score:"
        picks = by("match_score")[:4]

    body = "\n".join(_line(p) for p in picks)
    best = picks[0] if picks else None
    closer = ""
    if best:
        closer = (
            f"\n\nMy pick: **{best.get('address')}** — {best.get('rentable_rooms') or 0} room(s) "
            f"to rent, ~{money(best.get('monthly_boarder_income'))}/mo boarder income, net "
            f"{money(best.get('net_monthly_outlay'))}/mo, paying off in "
            f"~{best.get('payoff_years_accelerated') or '—'} years."
        )
    return {
        "ok": True,
        "content": f"{intro}\n\n{body}{closer}\n\n_Grounded in your current matches. "
        "Not financial advice._",
        "model": ENGINE_NAME,
    }


# Christchurch buyer knowledge base for the general advisor.
ADVISOR_KB: list[tuple[tuple[str, ...], str]] = [
    (
        ("fix", "term", "rate", "one year", "two year"),
        "**Fixing your mortgage.** Short fixes (6mo–1yr) are currently the cheapest carded "
        "rates and let you re-fix lower if the OCR keeps easing. A 2-year fix buys certainty if "
        "you'd rather lock your budget. A common play: split the loan — fix part for 1 year to "
        "capture falling rates, fix part for 2 years for stability, and keep a small "
        "floating/offset portion to dump boarder income against. Talk to a mortgage broker "
        "(free to you) before committing.",
    ),
    (
        ("principal", "loan structure", "offset", "revolving", "pay it off"),
        "**Paying the principal off fastest.** Structure the loan so your boarder surplus hits "
        "principal every payment: (1) keep a floating or revolving-credit portion and funnel all "
        "room income into it; (2) on fixed portions, use the bank's allowance for extra "
        "repayments (usually up to 5%/yr penalty-free); (3) pay fortnightly, not monthly — 26 "
        "half-payments is one extra month a year; (4) re-fix at lower rates but keep your "
        "payment the same so the difference attacks principal. On a $450k loan, reinvesting "
        "~$2,000/mo of boarder income can cut a 30-year term to roughly 13 years.",
    ),
    (
        ("boarder", "standard cost", "tax free", "245", "flatmate", "rent a room"),
        "**Boarder income & tax.** Under IRD's standard-cost method you can receive up to "
        "**$245/week per boarder, max 4 boarders**, tax-free — no rental accounts to file, "
        "provided you stay within the weekly threshold. That's up to roughly $50,960/yr "
        "tax-free. Above $245/wk per boarder, the excess is taxable. Keeping 3–4 boarders at "
        "~$220/wk each stays under the cap and covers most sub-$500k Christchurch mortgages. "
        "Confirm your own situation with IRD or an accountant.",
    ),
    (
        ("deposit", "kiwisaver", "first home", "grant", "kainga ora", "5%"),
        "**Deposit, KiwiSaver & First Home Grant.** After 3+ years of KiwiSaver contributions "
        "you can withdraw most of your balance (leaving $1,000) toward a deposit, and may "
        "qualify for the First Home Grant. The Kāinga Ora First Home Loan allows a 5% deposit "
        "for eligible buyers under the Christchurch price cap. Start the KiwiSaver withdrawal "
        "2–3 months before you buy — it takes 10–15 business days.",
    ),
    (
        ("auction", "deadline", "negotiat", "offer", "tender"),
        "**Buying methods in NZ.** *Auction* — unconditional, so have finance, a builder's "
        "report and LIM done beforehand; set a hard ceiling from comparable sales. *Deadline "
        "sale* — submit a strong, early offer; vendors sometimes engage pre-deadline. *Price by "
        "negotiation / asking price* — open below and justify with comparables. Most sub-$500k "
        "Christchurch listings publish no price, so getting pre-approval and reports lined up "
        "early is your biggest advantage.",
    ),
    (
        ("suburb", "where", "best area", "location"),
        "**Where to buy under $500k in Christchurch.** Best value plus yield: the east (Aranui, "
        "Wainoni, New Brighton — coastal regeneration underway) and inner-east (Linwood, "
        "Woolston, Phillipstown — central and gentrifying). For boarders specifically, anything "
        "near UC/Ilam, Riccarton, Addington (hospital) or Hornby (employment) lets rooms easily. "
        "The Insights page has the full suburb table with yields and 5-year growth.",
    ),
]


def answer_general(question: str) -> dict:
    """Answer a mortgage / tax / strategy question from the knowledge base."""
    q = question.lower()
    for keywords, answer in ADVISOR_KB:
        if any(k in q for k in keywords):
            return {
                "ok": True,
                "content": answer + "\n\n_General information, not personalised financial advice._",
                "model": ENGINE_NAME,
            }
    return {
        "ok": True,
        "content": (
            "Here's the HouseScout playbook: buy a 3–4 bedroom house under $500k with a garage "
            "and a backyard, live in it, and rent the spare rooms to boarders — up to "
            "**$245/wk each (max 4) is tax-free** under IRD's standard-cost method. Reinvest "
            "that income into extra mortgage repayments to be debt-free in roughly 13–18 years "
            "instead of 30.\n\nAsk me about: fixing your mortgage, paying the loan off fastest, "
            "boarder tax rules, deposit/KiwiSaver/First Home Grant, buying at auction, or the "
            "best suburbs. For listing-specific picks, switch to **Listings** mode.\n\n"
            "_General information, not personalised financial advice._"
        ),
        "model": ENGINE_NAME,
    }


def finance_summary(fin: dict, price: float | None, weekly_rent: float = 220.0) -> dict:
    """Reshape a full finance result into the compact dict the writers above expect."""
    boarder = fin.get("boarder") or {}
    rooms = boarder.get("rentable_rooms") or 0
    standard = fin.get("standard") or {}
    accelerated = fin.get("accelerated") or {}
    return {
        "rooms": rooms,
        "monthly_payment": fin.get("monthly_payment"),
        "monthly_income": fin.get("monthly_boarder_income"),
        "monthly_holding": fin.get("monthly_holding_costs"),
        "net_outlay": fin.get("net_monthly_outlay") or 0,
        "weekly_gross": boarder.get("weekly_gross"),
        "tax_free_weekly": min(weekly_rent, BOARDER_TAX_FREE_WEEKLY) * min(rooms, MAX_BOARDERS),
        "gross_yield": fin.get("gross_yield_pct"),
        "payoff_std": standard.get("payoff_years"),
        "payoff_acc": accelerated.get("payoff_years"),
        "years_saved": fin.get("years_saved"),
        "interest_saved": fin.get("interest_saved"),
    }
