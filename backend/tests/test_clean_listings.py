"""Tests for scripts/clean_listings.py — the fixes found in the Nov 2026 live scrape."""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import clean_listings as c  # noqa: E402


def test_hectares_stored_as_square_metres_are_converted():
    l = c.clean({"property_type": "lifestyle", "land_area_m2": 4.0, "bedrooms": 3})
    assert l["land_area_m2"] == 40_000
    assert any("ha" in f for f in l["data_fixes"])


def test_apartments_keep_small_land_figures():
    l = c.clean({"property_type": "apartment", "land_area_m2": 12.0})
    assert l["land_area_m2"] == 12.0


def test_bare_section_typed_as_house_is_retyped():
    l = c.clean({"property_type": "house", "description": "Priced from $235,000 for 600sqm. Build your dream."})
    assert l["property_type"] == "section"


def test_a_house_with_bedrooms_is_never_retyped_as_section():
    l = c.clean({"property_type": "house", "bedrooms": 3, "description": "Sunny section, 3 bedroom home"})
    assert l["property_type"] == "house"


def test_house_on_hectares_becomes_lifestyle():
    l = c.clean({"property_type": "house", "bedrooms": 4, "land_area_m2": 4.0})
    assert l["property_type"] == "lifestyle"


def test_attributes_are_filled_from_text_only_when_missing():
    l = c.clean({"property_type": "house", "bedrooms": 2,
                 "description": "Spacious 4 bedroom, 2 bathroom, 180m² home on a 650sqm section"})
    assert l["bedrooms"] == 2  # structured field wins
    assert l["bathrooms"] == 2
    assert l["floor_area_m2"] == 180
    assert l["land_area_m2"] == 650


def test_new_build_needs_a_dwelling_not_a_new_kitchen():
    assert c.looks_new_build({"description": "Brand new 2-bed townhouse with garage"})
    assert c.looks_new_build({"description": "Modern new-build homes in Somerfield"})
    assert not c.looks_new_build({"description": "Renovated, with a brand-new kitchen and carpet"})
    assert not c.looks_new_build({"description": "settle into your new home before Christmas"})
