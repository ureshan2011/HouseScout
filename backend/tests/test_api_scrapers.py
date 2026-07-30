"""Tests for the plain-HTTP listing scraper (scraper/api_scrapers.py).

This code path failed in the worst possible way: the previous HTMLParser closed each
listing on an `</article>` or `</li>` tag and read `data-test="price"` / `"address"`
fields, none of which exist in the live markup (tiles are `<div>`, fields are
`standard-tile__search-result__address`, `price-display__price-method`, `bedroom`…).
It returned an empty list rather than raising, so every build silently fell back to
hardcoded seed data and nobody noticed the dataset had stopped updating.

These tests pin the extraction against markup shaped like the real page, so a future
change breaks a test instead of quietly zeroing the dataset again.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from scraper import api_scrapers as api  # noqa: E402

MEDIA = "https://mediaserver.realestate.co.nz/listings"


def tile(
    listing_id: str = "43097193",
    slug: str = "51-bickerton-street-wainoni",
    address: str = "51 Bickerton Street, WAINONI",
    price_method: str = "Deadline Sale",
    bedrooms: str = "3",
    bathrooms: str = "1",
    land: str = "620m<sup>2</sup>",
    property_type: str = "House",
    description: str = "Tidy family home with a garage.",
    photo_hash: str = "e87b42ae692f4fdc",
) -> str:
    """Markup shaped like a real realestate.co.nz search tile."""
    return f"""
  <div class="tile listing-tile relative mb-8" data-test="tile">
    <div class="tile--body md:flex">
      <a class="ember-view" href="/{listing_id}/residential/sale/{slug}">
        <div data-test="image" class="relative">
          <img src="{MEDIA}/{listing_id}/{photo_hash}.crop.354x236.jpg?options=compress"
               srcset="{MEDIA}/{listing_id}/{photo_hash}.crop.100x66.jpg?options=compress 100w,
                       {MEDIA}/{listing_id}/{photo_hash}.crop.840x560.jpg?options=compress 840w" />
        </div>
      </a>
      <div class="font-semibold" data-test="standard-tile__search-result__address">{address}</div>
      <div class="price" data-test="price-display__price-method">{price_method}</div>
      <div data-test="bedroom">{bedrooms}</div>
      <div data-test="bathroom">{bathrooms}</div>
      <div data-test="land-area">{land}</div>
      <div data-test="tile__search-result__content__features__divider"
           title="{property_type}">{property_type}</div>
      <div data-test="tile__search-result__content__description">{description}</div>
    </div>
  </div>
"""


def page(*tiles: str) -> str:
    return f"<html><body><div class='results'>{''.join(tiles)}</div></body></html>"


# --------------------------------------------------------------------------- #
# Tile extraction
# --------------------------------------------------------------------------- #
def test_extracts_a_single_tile():
    items = api.parse_search_html(page(tile()))
    assert len(items) == 1
    item = items[0]
    assert item["source_id"] == "43097193"
    assert item["href"] == "/43097193/residential/sale/51-bickerton-street-wainoni"
    assert item["address"] == "51 Bickerton Street, WAINONI"
    assert item["price_text"] == "Deadline Sale"
    assert item["bedrooms"] == "3"
    assert item["bathrooms"] == "1"
    assert "620m" in item["land_area"]
    assert item["property_type"] == "House"


def test_extracts_every_tile_on_a_page():
    items = api.parse_search_html(
        page(
            tile(listing_id="43097193"),
            tile(listing_id="43097175", slug="1-137-harewood-road-papanui"),
            tile(listing_id="43097126", slug="31-comer-street-halswell"),
        )
    )
    assert [i["source_id"] for i in items] == ["43097193", "43097175", "43097126"]


def test_returns_empty_for_a_page_with_no_tiles():
    assert api.parse_search_html("<html><body>Nothing here</body></html>") == []


def test_skips_a_tile_with_no_listing_link():
    broken = '<div data-test="tile"><div data-test="bedroom">3</div></div>'
    assert api.parse_search_html(page(broken)) == []


def test_picks_the_largest_photo_variant():
    items = api.parse_search_html(page(tile()))
    # 840x560 beats the 354x236 src and the 100x66 srcset entry.
    assert items[0]["images"] == [
        f"{MEDIA}/43097193/e87b42ae692f4fdc.crop.840x560.jpg?options=compress"
    ]


def test_tolerates_a_tile_with_no_photo():
    no_photo = (
        '<div data-test="tile"><a href="/43097193/residential/sale/x"></a>'
        '<div data-test="standard-tile__search-result__address">1 A St, ARANUI</div></div>'
    )
    items = api.parse_search_html(page(no_photo))
    assert items[0]["images"] == []


def test_missing_fields_are_simply_absent():
    minimal = (
        '<div data-test="tile"><a href="/43097193/residential/sale/x"></a>'
        '<div data-test="standard-tile__search-result__address">1 A St, ARANUI</div></div>'
    )
    item = api.parse_search_html(page(minimal))[0]
    assert "bedrooms" not in item
    assert "price_text" not in item


# --------------------------------------------------------------------------- #
# Text helpers
# --------------------------------------------------------------------------- #
def test_text_strips_tags_and_collapses_whitespace():
    assert api._text("  620m<sup>2</sup>\n   House  ") == "620m 2 House"
    assert api._text(None) == ""


@pytest.mark.parametrize(
    "text,expected", [("3", 3), (" 4 bed", 4), ("620m 2", 620), ("House", None), ("", None)]
)
def test_leading_int(text, expected):
    assert api._leading_int(text) == expected


def test_split_suburb_title_cases_a_shouted_suburb():
    assert api._split_suburb("51 Bickerton Street, WAINONI") == (
        "51 Bickerton Street, Wainoni",
        "Wainoni",
    )


def test_split_suburb_leaves_a_properly_cased_suburb_alone():
    assert api._split_suburb("1/137 Harewood Road, Papanui") == (
        "1/137 Harewood Road, Papanui",
        "Papanui",
    )


def test_split_suburb_handles_an_address_with_no_suburb():
    assert api._split_suburb("Somewhere") == ("Somewhere", None)


def test_split_suburb_keeps_multipart_addresses_intact():
    address, suburb = api._split_suburb("Unit 4, 12 Long Road, HORNBY")
    assert suburb == "Hornby"
    assert address == "Unit 4, 12 Long Road, Hornby"


# --------------------------------------------------------------------------- #
# End-to-end mapping to NormalisedListing
# --------------------------------------------------------------------------- #
def test_scrape_maps_tiles_to_normalised_listings(monkeypatch):
    monkeypatch.setattr(api, "_fetch", lambda url, timeout=30: page(tile()))
    rows = api.scrape_realestate_api(max_pages=1)
    assert len(rows) == 1
    row = rows[0]
    assert row.source == "realestate.co.nz"
    assert row.source_id == "43097193"
    assert row.url == "https://www.realestate.co.nz/43097193/residential/sale/51-bickerton-street-wainoni"
    assert row.suburb == "Wainoni"
    assert row.bedrooms == 3
    assert row.bathrooms == 1
    assert row.land_area_m2 == 620.0
    assert row.property_type == "house"
    assert row.has_garage is True  # from the description
    assert row.price is None       # "Deadline Sale" publishes no figure
    assert row.price_text == "Deadline Sale"


def test_scrape_keeps_listings_with_no_published_price():
    """The majority of the market; dropping them would gut the dataset."""
    for method in ("Deadline Sale", "Auction", "Negotiation", "POA"):
        rows = _scrape_one(tile(price_method=method))
        assert len(rows) == 1, method
        assert rows[0].price is None


def test_scrape_parses_a_published_price():
    rows = _scrape_one(tile(price_method="Asking Price $430,000"))
    assert rows[0].price == 430_000.0


def test_scrape_drops_a_published_price_above_the_ceiling():
    rows = _scrape_one(tile(price_method="$1,795,000"), price_max=1_000_000)
    assert rows == []


def test_scrape_keeps_a_published_price_under_the_ceiling():
    rows = _scrape_one(tile(price_method="$649,000"), price_max=1_000_000)
    assert rows[0].price == 649_000.0


def test_scrape_reads_property_type_from_its_own_element():
    """"Townhouse" must not be read as "house" — scoring treats them very differently."""
    assert _scrape_one(tile(property_type="Townhouse"))[0].property_type == "townhouse"
    assert _scrape_one(tile(property_type="Unit"))[0].property_type == "unit"
    assert _scrape_one(tile(property_type="Apartment"))[0].property_type == "apartment"
    assert _scrape_one(tile(property_type="House"))[0].property_type == "house"


def test_scrape_falls_back_to_the_land_text_when_the_type_element_is_absent():
    no_type = (
        '<div data-test="tile"><a href="/43097193/residential/sale/x"></a>'
        '<div data-test="standard-tile__search-result__address">1 A St, ARANUI</div>'
        '<div data-test="land-area">158m Townhouse</div></div>'
    )
    import unittest.mock as mock

    with mock.patch.object(api, "_fetch", lambda url, timeout=30: page(no_type)):
        rows = api.scrape_realestate_api(max_pages=1)
    assert rows[0].property_type == "townhouse"


def test_scrape_defaults_property_type_to_house():
    assert _scrape_one(tile(land="", property_type=""))[0].property_type == "house"


def test_scrape_deduplicates_pagination_overlap(monkeypatch):
    # Same listing returned on both pages: it must be counted once.
    monkeypatch.setattr(api, "_fetch", lambda url, timeout=30: page(tile(), tile()))
    rows = api.scrape_realestate_api(max_pages=3)
    assert len(rows) == 1


def test_scrape_stops_when_a_page_has_no_tiles(monkeypatch):
    pages = [page(tile()), page(), page(tile(listing_id="43099999"))]
    calls = {"n": 0}

    def fake_fetch(url, timeout=30):
        result = pages[min(calls["n"], len(pages) - 1)]
        calls["n"] += 1
        return result

    monkeypatch.setattr(api, "_fetch", fake_fetch)
    rows = api.scrape_realestate_api(max_pages=3)
    # Stops at the empty page, so the third page's listing is never reached.
    assert [r.source_id for r in rows] == ["43097193"]


def test_scrape_stops_on_a_failed_fetch(monkeypatch):
    monkeypatch.setattr(api, "_fetch", lambda url, timeout=30: None)
    assert api.scrape_realestate_api(max_pages=3) == []


def test_scrape_skips_a_tile_with_no_address(monkeypatch):
    no_address = (
        '<div data-test="tile"><a href="/43097193/residential/sale/x"></a>'
        '<div data-test="bedroom">3</div></div>'
    )
    monkeypatch.setattr(api, "_fetch", lambda url, timeout=30: page(no_address))
    assert api.scrape_realestate_api(max_pages=1) == []


def test_every_registered_scraper_accepts_the_uniform_signature():
    """The registry calls each scraper with price_max and max_pages.

    scrape_trademe_rss previously took only price_max, so calling it through the
    registry raised TypeError.
    """
    import inspect

    for name, fn in api.ALL_API_SCRAPERS.items():
        params = inspect.signature(fn).parameters
        assert "price_max" in params, name
        assert "max_pages" in params, name


def _scrape_one(tile_html: str, price_max: int = 1_000_000):
    """Run the scraper over a single synthetic page."""
    import unittest.mock as mock

    with mock.patch.object(api, "_fetch", lambda url, timeout=30: page(tile_html)):
        return api.scrape_realestate_api(price_max=price_max, max_pages=1)
