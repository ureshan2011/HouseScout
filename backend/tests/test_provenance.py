"""Tests for the data-provenance annotator (scripts/provenance.py).

These flags are what stop a modelled price being displayed as an asking price, so
their behaviour is load-bearing for the product's honesty, not cosmetic.

The corpus is now scrape-only — hand-written sample records were removed — so there
are two tiers: a published price ("observed") or the valuation model's estimate
("estimated").
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import provenance  # noqa: E402


def listing(**kw) -> dict:
    base = {
        "source_id": "43070799",
        "price": 450_000,
        "price_text": "Asking Price $450,000",
        "price_estimate": 448_000,
        "bedrooms": 3,
        "bathrooms": 1,
        "land_area_m2": 600,
        "floor_area_m2": 110,
        "images": [{"url": "photos/1-0.jpg", "position": 0}],
        "enrichment": {
            "rateable_value": 420_000,
            "estimate_value": 460_000,
            "rental_estimate_weekly": 480,
        },
    }
    base.update(kw)
    return base


def test_published_price_is_marked_observed():
    a = provenance.annotate(listing())
    assert a["provenance"]["price"] == "observed"
    assert a["data_quality"] == "observed"
    assert "price" not in a["estimated_fields"]


def test_auction_price_is_marked_not_published():
    a = provenance.annotate(listing(price_text="Auction", price=None))
    assert a["provenance"]["price"] == "not_published"
    assert a["data_quality"] == "estimated"
    # The model's estimate is what fills the gap, and it is flagged as modelled.
    assert "price_estimate" in a["estimated_fields"]


def test_deadline_sale_and_negotiation_are_not_published():
    for text in ("Deadline Sale", "By Negotiation", "POA", ""):
        a = provenance.annotate(listing(price_text=text, price=None))
        assert a["data_quality"] == "estimated", text


def test_price_estimate_is_flagged_as_modelled_when_present():
    assert provenance.annotate(listing())["provenance"]["price_estimate"] == "modelled"


def test_absent_price_estimate_is_unknown():
    a = provenance.annotate(listing(price_estimate=None))
    assert a["provenance"]["price_estimate"] == "unknown"
    assert "price_estimate" not in a["estimated_fields"]


def test_every_record_is_marked_as_scraped():
    """There is no sample tier any more — the corpus is scrape-only."""
    assert provenance.annotate(listing())["provenance"]["record"] == "scraped"
    assert provenance.annotate(listing())["data_quality"] in ("observed", "estimated")


def test_enquiries_over_a_figure_counts_as_published():
    a = provenance.annotate(listing(price_text="Enquiries Over $418,000"))
    assert a["provenance"]["price"] == "observed"


def test_enrichment_values_are_always_modelled():
    a = provenance.annotate(listing())
    for field in ("rateable_value", "estimate_value", "rental_estimate_weekly"):
        assert a["provenance"][field] == "modelled"
        assert field in a["estimated_fields"]


def test_absent_enrichment_is_unknown_not_modelled():
    a = provenance.annotate(listing(enrichment={}))
    assert a["provenance"]["rateable_value"] == "unknown"
    assert "rateable_value" not in a["estimated_fields"]


def test_coordinates_are_never_claimed_as_geocoded():
    assert provenance.annotate(listing())["provenance"]["coordinates"] == "suburb_centroid"


def test_missing_physical_attributes_are_unknown():
    a = provenance.annotate(listing(bedrooms=None, land_area_m2=None, floor_area_m2=None))
    assert a["provenance"]["bedrooms"] == "unknown"
    assert a["provenance"]["land_area_m2"] == "unknown"
    # "unknown" is not an estimate we invented, so it must not appear as one.
    assert "bedrooms" not in a["estimated_fields"]


def test_photo_flag_tracks_whether_photos_were_harvested():
    assert provenance.annotate(listing())["provenance"]["photos"] == "source"
    assert provenance.annotate(listing(images=[]))["provenance"]["photos"] == "none"


def test_annotation_is_idempotent():
    once = provenance.annotate(listing())
    twice = provenance.annotate(dict(once))
    assert once["provenance"] == twice["provenance"]
    assert once["estimated_fields"] == twice["estimated_fields"]
    assert once["data_quality"] == twice["data_quality"]
