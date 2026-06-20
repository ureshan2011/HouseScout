"""Tests for the matching/scoring engine."""
from __future__ import annotations

from app.scoring import Criteria, passes_hard_filters, score_listing


def base_listing(**over):
    d = {
        "price": 450_000, "bedrooms": 3, "has_garage": True, "land_area_m2": 500,
        "property_type": "house", "days_on_market": 5,
        "enrichment": {"estimate_value": 470_000},
    }
    d.update(over)
    return d


def test_passes_when_all_criteria_met():
    ok, reasons = passes_hard_filters(base_listing(), Criteria())
    assert ok and reasons == []


def test_fails_without_garage():
    ok, reasons = passes_hard_filters(base_listing(has_garage=False), Criteria())
    assert not ok and any("garage" in r for r in reasons)


def test_fails_over_budget():
    ok, reasons = passes_hard_filters(base_listing(price=600_000), Criteria())
    assert not ok and any("budget" in r for r in reasons)


def test_apartment_fails_backyard():
    ok, reasons = passes_hard_filters(
        base_listing(property_type="apartment", land_area_m2=None), Criteria()
    )
    assert not ok and any("backyard" in r for r in reasons)


def test_tiny_backyard_fails():
    ok, reasons = passes_hard_filters(base_listing(land_area_m2=20), Criteria())
    assert not ok


def test_townhouse_scores_lower_than_house():
    house = score_listing(base_listing(property_type="house"), Criteria())
    town = score_listing(base_listing(property_type="townhouse"), Criteria())
    assert house["match_score"] > town["match_score"]


def test_more_bedrooms_improve_rentability():
    two = score_listing(base_listing(bedrooms=2), Criteria())
    five = score_listing(base_listing(bedrooms=5), Criteria())
    assert five["components"]["rentability"] > two["components"]["rentability"]
    assert five["rentable_rooms"] == 4


def test_score_in_range():
    s = score_listing(base_listing(), Criteria())
    assert 0 <= s["match_score"] <= 100
