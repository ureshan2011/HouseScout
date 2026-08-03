"""Tests for multi-district ingestion.

Two behaviours that only appear once coverage is more than one city, and that would
each fail silently:

1. **Region tagging.** If the scraper does not stamp the district onto each row, the
   frontend's district filter has nothing to filter on and the menu renders empty —
   with the listings themselves looking perfectly fine.

2. **District-scoped dedupe.** ``norm_address`` deliberately strips street-type words
   ("Street", "Road", "Place"), so "12 Queen Street, Richmond" in Nelson and "12 Queen
   Road, Richmond" in Christchurch normalise to the same key. Unscoped, the merge step
   would drop one of two genuinely different properties and report a smaller dataset
   as if that were the true count.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from scraper import api_scrapers as api  # noqa: E402
from scraper.regions import REGIONS  # noqa: E402

# tests/ is a package, so the shared realestate.co.nz tile fixtures import relatively
# rather than being duplicated here.
from .test_api_scrapers import page, tile  # noqa: E402


@pytest.fixture
def captured_urls(monkeypatch):
    """Record every URL the scraper requests and serve it one tile."""
    urls: list[str] = []

    def fake_fetch(url: str, timeout: int = 30):
        urls.append(url)
        # One page of results, then nothing — so max_pages doesn't dominate the test.
        return page(tile()) if url.endswith("page=1") else page()

    monkeypatch.setattr(api, "_fetch", fake_fetch)
    return urls


def test_region_selects_the_search_path(captured_urls):
    api.scrape_realestate_api(region="dunedin-city", max_pages=1)
    assert captured_urls
    assert "/residential/sale/otago/dunedin-city?" in captured_urls[0]


def test_default_region_is_christchurch(captured_urls):
    """Callers that pass no region keep the pre-existing behaviour exactly."""
    api.scrape_realestate_api(max_pages=1)
    assert "/residential/sale/canterbury/christchurch-city?" in captured_urls[0]


def test_unknown_region_falls_back_rather_than_building_a_broken_url(captured_urls):
    api.scrape_realestate_api(region="not-a-district", max_pages=1)
    assert "/residential/sale/canterbury/christchurch-city?" in captured_urls[0]


def test_a_region_object_is_accepted_as_well_as_a_key(captured_urls):
    api.scrape_realestate_api(region=REGIONS["wellington-city"], max_pages=1)
    assert "/residential/sale/wellington/wellington-city?" in captured_urls[0]


def test_listings_carry_their_district(captured_urls):
    rows = api.scrape_realestate_api(region="dunedin-city", max_pages=1)
    assert rows, "fixture should yield at least one listing"
    for row in rows:
        assert row.region == "dunedin-city"
        assert row.region_name == "Dunedin, Otago"


def test_region_survives_the_record_mapping():
    """build_listings must carry region through to listings.json, not drop it."""
    from build_listings import _from_normalised  # type: ignore

    rows = api.parse_search_html(page(tile()))
    assert rows  # sanity

    from scraper.base import NormalisedListing

    item = NormalisedListing(
        source="realestate.co.nz",
        source_id="1",
        address="51 Bickerton Street, Wainoni",
        region="christchurch-city",
        region_name="Christchurch, Canterbury",
    )
    record = _from_normalised(item)
    assert record["region"] == "christchurch-city"
    assert record["region_name"] == "Christchurch, Canterbury"


# --------------------------------------------------------------------------- #
# Dedupe must not collapse across districts
# --------------------------------------------------------------------------- #
def _rows() -> list[dict]:
    # These two normalise identically: norm_address strips "Street"/"Road", leaving
    # "12queenrichmond" for both. Only the district tells them apart.
    return [
        {
            "source": "realestate.co.nz",
            "source_id": "a",
            "address": "12 Queen Street, Richmond",
            "region": "nelson",
            "price": 500_000,
        },
        {
            "source": "realestate.co.nz",
            "source_id": "b",
            "address": "12 Queen Road, Richmond",
            "region": "christchurch-city",
            "price": 400_000,
        },
    ]


def test_same_street_in_two_districts_is_two_listings():
    from build_listings import dedupe_and_number, norm_address  # type: ignore

    rows = _rows()
    # Guard the premise: without the district these really would collide.
    assert norm_address(rows[0]["address"]) == norm_address(rows[1]["address"])

    merged = dedupe_and_number(rows)
    assert len(merged) == 2
    assert {l["id"] for l in merged} == {1, 2}


def test_merge_step_scopes_by_district_too():
    """scripts/merge_listings.py has its own copy of the key; it must agree."""
    from merge_listings import dedupe_and_number as merge_dedupe  # type: ignore

    assert len(merge_dedupe(_rows())) == 2


def test_true_duplicates_within_a_district_still_collapse():
    from build_listings import dedupe_and_number  # type: ignore

    rows = _rows()
    rows[1]["region"] = "nelson"
    rows[1]["address"] = "12 Queen Street, Richmond"
    assert len(dedupe_and_number(rows)) == 1


def test_untagged_rows_still_dedupe_by_address():
    """Older partials carry no region; they must not each become their own key."""
    from build_listings import dedupe_and_number  # type: ignore

    rows = _rows()
    for r in rows:
        r["region"] = None
        r["address"] = "12 Queen Street, Richmond"
    assert len(dedupe_and_number(rows)) == 1
