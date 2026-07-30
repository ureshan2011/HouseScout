"""Tests for the deterministic analysis engine (backend/app/analysis.py).

This module replaced the LM Studio proxy, so the guarantees worth pinning down are
the ones a language model could not give us: identical output for identical input,
no claim that is not backed by a figure, and explicit labelling when the headline
price is our estimate rather than the vendor's.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from app import analysis  # noqa: E402


def listing(**kw) -> dict:
    base = {
        "address": "27 Parker Street, Hornby",
        "suburb": "Hornby",
        "price": 450_000,
        "price_text": "Asking Price $450,000",
        "bedrooms": 4,
        "bathrooms": 1,
        "has_garage": True,
        "land_area_m2": 700,
        "property_type": "house",
        "description": "Spacious family home.",
        "provenance": {"price": "observed", "record": "scraped"},
    }
    base.update(kw)
    return base


def fin(**kw) -> dict:
    base = {
        "rooms": 3,
        "monthly_payment": 2200.0,
        "monthly_income": 2860.0,
        "monthly_holding": 825.0,
        "net_outlay": 165.0,
        "weekly_gross": 660.0,
        "tax_free_weekly": 660.0,
        "gross_yield": 7.6,
        "payoff_std": 30.0,
        "payoff_acc": 13.5,
        "years_saved": 16.5,
        "interest_saved": 260_000,
    }
    base.update(kw)
    return base


# --------------------------------------------------------------------------- #
# Determinism — the property an LLM could not offer
# --------------------------------------------------------------------------- #
def test_analysis_is_deterministic():
    a = analysis.build_analysis(listing(), fin(), 72)
    b = analysis.build_analysis(listing(), fin(), 72)
    assert a == b


def test_analysis_contains_every_expected_section():
    md = analysis.build_analysis(listing(), fin(), 72)
    for heading in ("**Verdict:**", "**Pros**", "**Cons / red flags**",
                    "**Rent-a-room potential**", "**Negotiation angle**"):
        assert heading in md


def test_analysis_includes_the_match_score_when_supplied():
    assert "72/100" in analysis.build_analysis(listing(), fin(), 72)
    assert "/100" not in analysis.build_analysis(listing(), fin(), None)


def test_analysis_always_carries_the_not_advice_disclaimer():
    assert "Not financial advice" in analysis.build_analysis(listing(), fin(), 72)


# --------------------------------------------------------------------------- #
# Provenance honesty
# --------------------------------------------------------------------------- #
def test_modelled_price_is_labelled_as_an_estimate_not_an_asking_price():
    l = listing(price_text="Deadline Sale", provenance={"price": "modelled", "record": "scraped"})
    md = analysis.build_analysis(l, fin(), 72)
    assert "HouseScout's estimate, not an asking price" in md
    assert "Estimated at" in md


def test_observed_price_is_not_labelled_as_an_estimate():
    md = analysis.build_analysis(listing(), fin(), 72)
    assert "not an asking price" not in md
    assert "Priced at" in md


def test_negotiation_advises_establishing_the_vendor_expectation_when_no_price_published():
    l = listing(price_text="POA", provenance={"price": "modelled", "record": "scraped"})
    text = analysis.negotiation(l, fin())
    assert "No price is published" in text


def test_negotiation_handles_auction_and_deadline_distinctly():
    auction = analysis.negotiation(listing(price_text="Auction"), fin())
    deadline = analysis.negotiation(listing(price_text="Deadline Sale"), fin())
    assert "auction" in auction.lower() and "hard ceiling" in auction
    assert "Deadline sale" in deadline
    assert auction != deadline


# --------------------------------------------------------------------------- #
# Verdict / pros / cons logic
# --------------------------------------------------------------------------- #
def test_verdict_is_strong_for_a_multi_room_garaged_house_under_budget():
    assert "Strong buy" in analysis.verdict(listing(), fin(rooms=3))


def test_verdict_is_marginal_when_there_are_no_spare_rooms():
    assert "Marginal" in analysis.verdict(listing(bedrooms=1), fin(rooms=0))


def test_missing_garage_appears_in_cons():
    text = " ".join(analysis.cons(listing(has_garage=False), fin()))
    assert "No garage" in text


def test_townhouse_downside_appears_in_cons():
    text = " ".join(analysis.cons(listing(property_type="townhouse"), fin()))
    assert "body-corp" in text


def test_unknown_land_area_prompts_verification():
    text = " ".join(analysis.cons(listing(land_area_m2=None, enrichment={}), fin()))
    assert "Land area not confirmed" in text


def test_pros_mention_the_generous_section():
    text = " ".join(analysis.pros(listing(land_area_m2=700), fin()))
    assert "700m²" in text


def test_pros_and_cons_are_never_empty():
    bare = {"price": None, "bedrooms": None, "has_garage": True, "property_type": "house",
            "land_area_m2": 500, "provenance": {"price": "observed"}}
    assert analysis.pros(bare, fin(rooms=2, net_outlay=100))
    assert analysis.cons(bare, fin(rooms=2, net_outlay=100))


def test_surplus_is_reported_when_boarders_cover_the_mortgage():
    text = " ".join(analysis.pros(listing(), fin(net_outlay=-350)))
    assert "surplus" in text


# --------------------------------------------------------------------------- #
# Rent narrative
# --------------------------------------------------------------------------- #
def test_rent_potential_explains_the_ird_threshold():
    text = analysis.rent_potential(listing(), fin())
    assert "standard-cost" in text
    assert "$660" in text


def test_rent_potential_handles_a_property_with_no_spare_rooms():
    text = analysis.rent_potential(listing(bedrooms=1), fin(rooms=0))
    assert "owner-occupier" in text


def test_rent_potential_reports_years_saved_when_present():
    assert "16.5 years sooner" in analysis.rent_potential(listing(), fin())
    assert "sooner" not in analysis.rent_potential(listing(), fin(years_saved=None))


# --------------------------------------------------------------------------- #
# Question answering
# --------------------------------------------------------------------------- #
def context_row(**kw) -> dict:
    base = {
        "address": "27 Parker Street",
        "suburb": "Hornby",
        "price": 450_000,
        "bedrooms": 4,
        "rentable_rooms": 3,
        "match_score": 72,
        "gross_yield_pct": 7.6,
        "monthly_boarder_income": 2860,
        "net_monthly_outlay": 165,
        "payoff_years_accelerated": 13.5,
    }
    base.update(kw)
    return base


def test_empty_context_says_so_rather_than_inventing_listings():
    out = analysis.answer_about_listings("what's best?", [])
    assert out["ok"] is True
    assert "don't have any matching listings" in out["content"]


def test_payoff_question_ranks_by_accelerated_payoff():
    rows = [
        context_row(address="Slow House", payoff_years_accelerated=25.0),
        context_row(address="Fast House", payoff_years_accelerated=11.0),
    ]
    content = analysis.answer_about_listings("which pays off fastest?", rows)["content"]
    assert content.index("Fast House") < content.index("Slow House")


def test_cheapest_question_ranks_by_price_ascending():
    rows = [context_row(address="Pricey", price=490_000), context_row(address="Cheap", price=380_000)]
    content = analysis.answer_about_listings("what's the cheapest?", rows)["content"]
    assert content.index("Cheap") < content.index("Pricey")


def test_yield_question_ranks_by_yield():
    rows = [context_row(address="Low", gross_yield_pct=4.0), context_row(address="High", gross_yield_pct=8.0)]
    content = analysis.answer_about_listings("best rental yield?", rows)["content"]
    assert content.index("High") < content.index("Low")


def test_boarder_question_ranks_by_rentable_rooms():
    rows = [context_row(address="OneRoom", rentable_rooms=1), context_row(address="FourRoom", rentable_rooms=4)]
    content = analysis.answer_about_listings("most rooms for boarders?", rows)["content"]
    assert content.index("FourRoom") < content.index("OneRoom")


def test_unrecognised_question_falls_back_to_overall_score():
    rows = [context_row(address="Weak", match_score=40), context_row(address="Strong", match_score=90)]
    content = analysis.answer_about_listings("tell me something", rows)["content"]
    assert content.index("Strong") < content.index("Weak")


@pytest.mark.parametrize(
    "question,expected",
    [
        ("should I fix for one year or two?", "Fixing your mortgage"),
        ("how do I pay off the principal fastest?", "Paying the principal off fastest"),
        ("what are the boarder tax rules?", "Boarder income & tax"),
        ("can I use my kiwisaver for a deposit?", "Deposit, KiwiSaver"),
        ("how does buying at auction work?", "Buying methods in NZ"),
        ("which suburb should I buy in?", "Where to buy under $500k"),
    ],
)
def test_advisor_routes_questions_to_the_right_knowledge_base_entry(question, expected):
    assert expected in analysis.answer_general(question)["content"]


def test_advisor_falls_back_to_the_playbook():
    out = analysis.answer_general("hello there")
    assert "HouseScout playbook" in out["content"]


def test_every_advisor_answer_is_marked_as_general_information():
    for q in ("fix my mortgage", "boarder tax", "hello"):
        assert "not personalised financial advice" in analysis.answer_general(q)["content"]


def test_answers_are_attributed_to_the_local_engine():
    assert analysis.answer_general("hi")["model"] == analysis.ENGINE_NAME
    assert analysis.answer_about_listings("hi", [context_row()])["model"] == analysis.ENGINE_NAME


# --------------------------------------------------------------------------- #
# finance_summary adapter
# --------------------------------------------------------------------------- #
def test_finance_summary_reshapes_a_full_finance_result():
    full = {
        "monthly_payment": 2200.0,
        "monthly_boarder_income": 2860.0,
        "monthly_holding_costs": 825.0,
        "net_monthly_outlay": 165.0,
        "gross_yield_pct": 7.6,
        "years_saved": 16.5,
        "interest_saved": 260_000,
        "boarder": {"rentable_rooms": 3, "weekly_gross": 660.0},
        "standard": {"payoff_years": 30.0},
        "accelerated": {"payoff_years": 13.5},
    }
    s = analysis.finance_summary(full, price=450_000)
    assert s["rooms"] == 3
    assert s["payoff_acc"] == 13.5
    # 3 rooms x $220/wk, all under the $245 threshold, so all of it is tax-free.
    assert s["tax_free_weekly"] == pytest.approx(660.0)


def test_finance_summary_caps_tax_free_income_at_the_ird_threshold():
    full = {"boarder": {"rentable_rooms": 3, "weekly_gross": 900.0}, "standard": {}, "accelerated": {}}
    s = analysis.finance_summary(full, price=450_000, weekly_rent=300.0)
    # $300/wk exceeds the $245 threshold, so only $245 per room counts.
    assert s["tax_free_weekly"] == pytest.approx(245.0 * 3)


def test_finance_summary_caps_rooms_at_the_boarder_limit():
    full = {"boarder": {"rentable_rooms": 7}, "standard": {}, "accelerated": {}}
    s = analysis.finance_summary(full, price=450_000)
    assert s["tax_free_weekly"] == pytest.approx(220.0 * analysis.MAX_BOARDERS)


def test_finance_summary_tolerates_an_empty_result():
    s = analysis.finance_summary({}, price=None)
    assert s["rooms"] == 0
    assert s["net_outlay"] == 0
