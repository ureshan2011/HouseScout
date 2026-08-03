"""Tests for the district catalogue and the suburb parser.

Two things are pinned here.

**Region resolution**, because coverage is now driven by a string in CI. If
``resolve_regions`` silently returned nothing for a valid spec, the build would
produce an empty site; if it raised on a typo, the build would fail outright. Neither
is acceptable, so both behaviours are asserted.

**Suburb extraction**, because it was wrong in production. ``scripts/scrape_listings.py``
took ``parts[-2]`` — the street — so 18 of the 157 published listings were filed under
a suburb like "571 Madras Street". That broke the suburb filter and made the valuation
model fall back to the city median for every affected row, silently.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from scraper.base import suburb_from_address  # noqa: E402
from scraper.regions import (  # noqa: E402
    DEFAULT_REGION_KEYS,
    REGIONS,
    region_choices,
    resolve_regions,
)


# --------------------------------------------------------------------------- #
# Catalogue integrity
# --------------------------------------------------------------------------- #
def test_district_keys_are_unique():
    """The key is the public identifier — a collision would silently merge districts."""
    assert len(REGIONS) == len({r.key for r in REGIONS.values()})


def test_every_region_builds_a_sane_path():
    """A district row is 'region/district'; a whole-region row is just 'region'."""
    for r in REGIONS.values():
        if r.district:
            assert r.path == f"{r.region}/{r.district}"
            assert r.path.count("/") == 1
        else:
            assert r.path == r.region
            assert "/" not in r.path
            # A whole-region row is keyed by its region, so `resolve_regions("gisborne")`
            # returns it whether the caller meant the region or the district.
            assert r.key == r.region
        assert r.island in ("north", "south")
        assert not r.path.startswith("/") and not r.path.endswith("/")


def test_default_keys_exist_in_the_catalogue():
    for key in DEFAULT_REGION_KEYS:
        assert key in REGIONS


def test_region_choices_is_serialisable_and_complete():
    choices = region_choices()
    assert len(choices) == len(REGIONS)
    assert {c["key"] for c in choices} == set(REGIONS)
    assert all(c["label"] for c in choices)


def test_label_does_not_repeat_the_region_name():
    """'Gisborne, Gisborne' reads as a bug; a whole-region row is just 'Gisborne'."""
    assert REGIONS["gisborne"].label == "Gisborne"
    assert REGIONS["christchurch-city"].label == "Christchurch, Canterbury"


def test_region_slugs_are_the_sites_own_not_the_official_council_names():
    """The slugs a reasonable guess gets wrong — each one silently broke a scrape.

    An unrecognised location returns HTTP 200 with the *nationwide* results, so these
    are not typos that fail loudly; they mislabel real listings. See
    scripts/verify_regions.py.
    """
    # "manawatu-wanganui" (no h) served the nationwide fallback.
    assert REGIONS["palmerston-north-city"].region == "manawatu-whanganui"
    # Nelson and Tasman are districts of "nelson-bays", not regions of their own.
    assert REGIONS["nelson"].region == "nelson-bays"
    assert REGIONS["tasman"].region == "nelson-bays"
    # Queenstown/Wānaka/Central Otago are not under "otago".
    assert REGIONS["wanaka"].region == "central-otago-lakes-district"
    assert REGIONS["dunedin-city"].region == "otago"
    # The Auckland legacy councils need the "-city" suffix.
    assert REGIONS["north-shore-city"].district == "north-shore-city"
    assert REGIONS["manukau-city"].district == "manukau-city"


# --------------------------------------------------------------------------- #
# Selection
# --------------------------------------------------------------------------- #
def test_blank_spec_falls_back_to_the_default():
    for spec in (None, "", "   "):
        assert [r.key for r in resolve_regions(spec)] == list(DEFAULT_REGION_KEYS)


def test_single_and_multiple_district_keys():
    assert [r.key for r in resolve_regions("dunedin-city")] == ["dunedin-city"]
    keys = [r.key for r in resolve_regions("dunedin-city,christchurch-city")]
    assert set(keys) == {"dunedin-city", "christchurch-city"}


def test_a_region_name_selects_every_district_in_it():
    keys = {r.key for r in resolve_regions("canterbury")}
    assert keys == {
        "hurunui", "waimakariri", "christchurch-city", "selwyn", "ashburton", "timaru",
    }


def test_island_selector():
    south = resolve_regions("island:south")
    assert all(r.island == "south" for r in south)
    assert "christchurch-city" in {r.key for r in south}
    assert "auckland-city" not in {r.key for r in south}


def test_all_selects_the_whole_catalogue():
    assert len(resolve_regions("all")) == len(REGIONS)


def test_results_are_deduped_and_in_catalogue_order():
    """Overlapping tokens must not scrape the same district twice."""
    keys = [r.key for r in resolve_regions("canterbury,christchurch-city,island:south")]
    assert len(keys) == len(set(keys))
    catalogue = [r.key for r in resolve_regions("all")]
    assert keys == [k for k in catalogue if k in set(keys)]


def test_unknown_tokens_are_skipped_not_fatal():
    """A typo in CI should narrow the scrape, never fail the build with zero listings."""
    assert [r.key for r in resolve_regions("dunedin-city,not-a-place")] == ["dunedin-city"]
    # Entirely unrecognised -> the default, not an empty list.
    assert [r.key for r in resolve_regions("mars,venus")] == list(DEFAULT_REGION_KEYS)


def test_selection_is_case_and_whitespace_insensitive():
    assert [r.key for r in resolve_regions(" Dunedin-City , ")] == ["dunedin-city"]


# --------------------------------------------------------------------------- #
# Suburb extraction — the regression that shipped
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    "address,expected",
    [
        ("571 Madras Street, Saint Albans", "Saint Albans"),
        ("10/7 Spencer Street, Addington", "Addington"),
        ("42B Marama Crescent, Mount Pleasant", "Mount Pleasant"),
        # Uppercase suburbs come back title-cased, as the tile markup shouts them.
        ("51 Bickerton Street, WAINONI", "Wainoni"),
        # Three parts: still the last one.
        ("1 Queen Street, Richmond, Nelson", "Nelson"),
    ],
)
def test_suburb_is_the_last_part_not_the_street(address, expected):
    assert suburb_from_address(address) == expected


@pytest.mark.parametrize("address", [None, "", "   ", "51 Bickerton Street"])
def test_no_suburb_part_returns_none(address):
    """Better to have no suburb than to record a street name as one."""
    assert suburb_from_address(address) is None


def test_numeric_trailing_part_is_not_a_suburb():
    """A postcode or unit number trailing the address is not a suburb."""
    assert suburb_from_address("51 Bickerton Street, 8061") is None
