"""Tests for the Trade Me tile and detail-page parsers.

Trade Me's tiles are ``<tm-property-premium-listing-card>`` custom elements whose
bed/bath/area row is unlabelled icons. The repo's generic per-field CSS selectors
matched none of it, so the Trade Me source returned zero listings and nothing said so.
The only machine-readable account of that row is one ``aria-label`` on the list
("2 bedrooms. 1 bathroom. floor area 78 meters square. land area 87 meters square."),
which is what these tests pin: if Trade Me reworks the markup, a test fails instead of
the source quietly going empty again.

The fakes below stand in for Playwright element handles, so no browser is needed.
"""
from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from scraper.regions import REGIONS  # noqa: E402
from scraper.sites import (  # noqa: E402
    SITES,
    _parse_trademe_card,
    _parse_trademe_detail,
    _trademe_listed_date,
)
from scraper.base import NormalisedListing  # noqa: E402

REGION = REGIONS["christchurch-city"]
CFG = SITES["trademe.co.nz"]


class El:
    def __init__(self, text="", attrs=None):
        self._text, self._attrs = text, attrs or {}

    def inner_text(self):
        return self._text

    def get_attribute(self, name):
        return self._attrs.get(name)


class Card:
    def __init__(self, parts: dict[str, El], imgs=()):
        self.parts, self.imgs = parts, list(imgs)

    def query_selector(self, sel):
        return self.parts.get(sel)

    def query_selector_all(self, sel):
        return self.imgs if sel == "img" else []


def make_card(label="2 bedrooms. 1 bathroom. floor area 78 meters square. land area 87 meters square.",
              price="Enquiries over $499,000", address="10/48 Ward Street, Addington, Christchurch City",
              href="/a/property/residential/sale/canterbury/christchurch-city/addington/listing/6175586119?rsqid=abc"):
    parts = {
        "a[href]": El(attrs={"href": href}),
        "tm-property-search-card-address-subtitle": El(address),
        "ul[aria-label]": El(attrs={"aria-label": label}),
        "tm-property-search-card-price-attribute": El(price),
        "tm-property-search-card-listing-title": El("City-Fringe Living"),
        "tm-property-search-card-listed-date": El("Listed Mon, 12 Oct"),
        "tm-agent": El("Kristian Danholt\nArizto Real Estate"),
    }
    imgs = [
        El(attrs={"src": "https://trademe.tmcdn.co.nz/tm/property/agent_logos/office_branding/1.jpg"}),
        El(attrs={"src": "https://trademe.tmcdn.co.nz/photoserver/full/2334685857.jpg"}),
    ]
    return Card(parts, imgs)


def test_tile_fields_come_from_the_aria_label():
    item = _parse_trademe_card(make_card(), CFG, REGION)
    assert item is not None
    assert (item.bedrooms, item.bathrooms) == (2, 1)
    assert item.floor_area_m2 == 78.0
    assert item.land_area_m2 == 87.0
    assert item.price == 499000.0
    assert item.source_id == "6175586119"
    assert "?" not in item.url


def test_floor_and_land_area_are_not_confused_when_only_one_is_present():
    only_floor = _parse_trademe_card(make_card(label="3 bedrooms. 2 bathrooms. floor area 160 meters square."), CFG, REGION)
    only_land = _parse_trademe_card(make_card(label="4 bedrooms. 2 bathrooms. land area 607 meters square."), CFG, REGION)
    assert (only_floor.floor_area_m2, only_floor.land_area_m2) == (160.0, None)
    assert (only_land.floor_area_m2, only_land.land_area_m2) == (None, 607.0)


def test_singular_bedroom_and_missing_parts():
    item = _parse_trademe_card(make_card(label="1 bedroom. 1 bathroom."), CFG, REGION)
    assert (item.bedrooms, item.bathrooms) == (1, 1)
    assert item.land_area_m2 is None


def test_unpublished_price_stays_none():
    for text in ("Price by negotiation", "Deadline sale by 28 Oct", "Auction on 11 Nov, 6:00 pm"):
        item = _parse_trademe_card(make_card(price=text), CFG, REGION)
        assert item.price is None, text
        assert item.price_text == text


def test_address_drops_the_district_suffix_and_keeps_the_suburb():
    item = _parse_trademe_card(make_card(), CFG, REGION)
    assert item.address == "10/48 Ward Street, Addington"


def test_photo_is_the_photoserver_image_not_the_agency_logo():
    item = _parse_trademe_card(make_card(), CFG, REGION)
    assert item.images == ["https://trademe.tmcdn.co.nz/photoserver/full/2334685857.jpg"]


def test_townhouse_url_sets_property_type():
    href = "/a/property/new-homes/new-townhouse-terraced/canterbury/christchurch-city/shirley/listing/6175538864"
    assert _parse_trademe_card(make_card(href=href), CFG, REGION).property_type == "townhouse"


def test_card_without_a_link_is_skipped():
    card = make_card()
    card.parts.pop("a[href]")
    assert _parse_trademe_card(card, CFG, REGION) is None


def test_listed_date_infers_the_year_without_landing_in_the_future():
    today = datetime(2026, 10, 26)
    assert _trademe_listed_date("Listed Mon, 12 Oct", today) == datetime(2026, 10, 12)
    # A December date seen in January belongs to the previous year.
    assert _trademe_listed_date("Listed Fri, 19 Dec", datetime(2026, 1, 5)) == datetime(2025, 12, 19)
    assert _trademe_listed_date("no date here", today) is None


class Page:
    def __init__(self, body):
        self.body = body

    def inner_text(self, sel):
        assert sel == "body"
        return self.body


def _detail_body(prose):
    return (
        "Broadband\nFibre\nAsk about this image\nAsk about this image\n" + prose +
        "\nSource: Please be aware that this information may have been sourced from third parties\n"
        "More\n32\nWatchlisted\n3\nDays on site\nLocal Schools\nSOME OTHER LISTING with a double garage\n"
    )


def _blank():
    return NormalisedListing(source="trademe.co.nz", source_id="1", raw_json={"href": "x"})


def test_detail_sets_garage_from_the_description_and_keeps_stats():
    item = _blank()
    _parse_trademe_detail(Page(_detail_body("Spacious home with a single garage and sunny section.")), item)
    assert item.has_garage is True
    assert "single garage" in item.description
    assert item.raw_json["watchlisted"] == 32
    assert item.raw_json["days_on_site"] == 3
    assert item.raw_json["href"] == "x"  # merged, not replaced


def test_detail_does_not_read_garage_from_text_after_the_listing():
    item = _blank()
    _parse_trademe_detail(Page(_detail_body("Sunny two-bedroom unit with off-street parking.")), item)
    assert item.has_garage is False
    assert "double garage" not in (item.description or "")


def test_detail_on_an_unrecognised_page_changes_nothing():
    item = _blank()
    _parse_trademe_detail(Page("Something completely different"), item)
    assert item.has_garage is False and item.description is None
