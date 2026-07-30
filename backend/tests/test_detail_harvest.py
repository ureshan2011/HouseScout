"""Tests for the detail-page harvest (scripts/detail_harvest.py).

This module fixed two blocking bugs, and the tests cover both:

  * **Blank listing cards** — from picking the wrong image variant, or letting
    non-photos (agent headshots, logos, thumbnails) through as house pictures.
  * **An empty result set** — search tiles carry no parking data and repeat the
    address as the "description", so garage detection saw nothing and every listing
    came back ``has_garage: False``. A garage is one of the buyer's hard filters, so
    the entire grid was empty. Detail pages state it explicitly.
"""
from __future__ import annotations

import io
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import detail_harvest  # noqa: E402

photos = detail_harvest  # the module handles photos and attributes from one fetch

PIL = pytest.importorskip("PIL", reason="Pillow drives the image checks")
from PIL import Image  # noqa: E402


def jpeg(width: int, height: int, quality: int = 92) -> bytes:
    """A noisy JPEG of the given size — noise so it doesn't compress to nothing."""
    im = Image.new("RGB", (width, height))
    px = im.load()
    for y in range(height):
        for x in range(width):
            px[x, y] = ((x * 7 + y * 13) % 256, (x * 3) % 256, (y * 5) % 256)
    buf = io.BytesIO()
    im.save(buf, format="JPEG", quality=quality)
    return buf.getvalue()


def media_url(photo_hash: str, w: int, h: int, listing_id: str = "43070799") -> str:
    return (
        f"https://mediaserver.realestate.co.nz/listings/{listing_id}/"
        f"{photo_hash}.crop.{w}x{h}.jpg"
    )


# --------------------------------------------------------------------------- #
# Image verification
# --------------------------------------------------------------------------- #
def test_accepts_a_landscape_house_photo():
    assert photos.check_house_image(jpeg(800, 457)) is True


def test_rejects_tiny_files():
    assert photos.check_house_image(b"\xff\xd8\xff\xd9") is False


def test_rejects_thumbnails_below_the_minimum_dimensions():
    assert photos.check_house_image(jpeg(200, 114)) is False


def test_rejects_small_square_images_that_look_like_headshots():
    # 400x400 is the classic agent-portrait shape.
    assert photos.check_house_image(jpeg(400, 400)) is False


def test_accepts_a_large_square_image():
    # A big square photo is plausibly a property shot, not a portrait crop.
    assert photos.check_house_image(jpeg(700, 700)) is True


def test_rejects_undecodable_bytes_that_are_merely_large():
    assert photos.check_house_image(b"x" * 4000) is False


# --------------------------------------------------------------------------- #
# Gallery extraction
# --------------------------------------------------------------------------- #
def test_largest_variants_picks_the_biggest_size_per_distinct_photo():
    html = " ".join(
        [
            media_url("aaaaaaaa11", 100, 57),
            media_url("aaaaaaaa11", 800, 457),
            media_url("aaaaaaaa11", 300, 171),
        ]
    )
    assert photos.largest_variants(html) == [media_url("aaaaaaaa11", 800, 457)]


def test_largest_variants_preserves_first_appearance_order():
    html = " ".join(
        [
            media_url("bbbbbbbb22", 800, 457),
            media_url("aaaaaaaa11", 800, 457),
            media_url("bbbbbbbb22", 990, 661),
        ]
    )
    assert photos.largest_variants(html) == [
        media_url("bbbbbbbb22", 990, 661),
        media_url("aaaaaaaa11", 800, 457),
    ]


def test_largest_variants_drops_photos_only_offered_as_thumbnails():
    html = media_url("cccccccc33", 100, 57)
    assert photos.largest_variants(html) == []


def test_largest_variants_respects_the_limit():
    html = " ".join(media_url(f"{i:08x}ff", 800, 457) for i in range(10))
    assert len(photos.largest_variants(html, limit=4)) == 4


def test_largest_variants_ignores_agent_and_logo_urls():
    html = " ".join(
        [
            "https://mediaserver.realestate.co.nz/listings/1/aaaaaaaa11.agent.800x457.jpg",
            media_url("bbbbbbbb22", 800, 457),
        ]
    )
    assert photos.largest_variants(html) == [media_url("bbbbbbbb22", 800, 457)]


def test_largest_variants_handles_pad_variants():
    url = (
        "https://mediaserver.realestate.co.nz/listings/43069226/"
        "d8b9e8db8817c1f42e2158822e85bbf7.pad-ffffff.990x661.jpg"
    )
    assert photos.largest_variants(url) == [url]


def test_largest_variants_returns_nothing_for_markup_without_photos():
    assert photos.largest_variants("<html><body>no photos here</body></html>") == []


# --------------------------------------------------------------------------- #
# Candidate discovery
# --------------------------------------------------------------------------- #
def test_candidate_urls_keeps_absolute_photo_urls():
    l = {"images": [{"url": media_url("aaaaaaaa11", 800, 457), "position": 0}]}
    assert photos.candidate_urls(l) == [media_url("aaaaaaaa11", 800, 457)]


def test_candidate_urls_skips_already_self_hosted_relative_paths():
    # Relative paths are already downloaded; re-fetching them would be pointless.
    assert photos.candidate_urls({"images": [{"url": "photos/1-0.jpg", "position": 0}]}) == []


def test_candidate_urls_tolerates_missing_and_malformed_images():
    assert photos.candidate_urls({}) == []
    assert photos.candidate_urls({"images": None}) == []
    assert photos.candidate_urls({"images": [{}, {"url": None}]}) == []


def test_detail_page_url_for_a_real_listing_id():
    l = {"source_id": "43070799", "source": "realestate.co.nz"}
    assert photos.detail_page_url(l) == "https://www.realestate.co.nz/43070799"


@pytest.mark.parametrize("sid", ["SEED-aranui-01", "", None, "123"])
def test_detail_page_url_rejects_non_listing_ids(sid):
    assert photos.detail_page_url({"source_id": sid, "source": "realestate.co.nz"}) is None


def test_detail_page_url_rejects_other_sources():
    assert photos.detail_page_url({"source_id": "43070799", "source": "trademe.co.nz"}) is None


# --------------------------------------------------------------------------- #
# Harvest bookkeeping
# --------------------------------------------------------------------------- #
def test_harvest_drops_unverified_remote_hotlinks(monkeypatch):
    """A hotlink we could not verify must not survive — it blanks the card later."""
    monkeypatch.setattr(photos, "harvest_one", lambda l, m=6: [])
    listings = [
        {"id": 1, "images": [{"url": media_url("aaaaaaaa11", 800, 457), "position": 0}]},
        {"id": 2, "images": [{"url": "photos/2-0.jpg", "position": 0}]},
    ]
    stats = photos.harvest(listings, workers=1)
    assert listings[0]["images"] == []           # remote hotlink dropped
    assert listings[1]["images"][0]["url"] == "photos/2-0.jpg"  # self-hosted kept
    assert stats["with_photos"] == 1
    assert stats["coverage_pct"] == 50.0


def test_harvest_keeps_newly_downloaded_photos(monkeypatch):
    monkeypatch.setattr(
        photos, "harvest_one", lambda l, m=6: [{"url": f"photos/{l['id']}-0.jpg", "position": 0}]
    )
    listings = [{"id": 1, "images": []}, {"id": 2, "images": []}]
    stats = photos.harvest(listings, workers=1)
    assert stats["listings"] == 2
    assert stats["with_photos"] == 2
    assert stats["photos"] == 2
    assert stats["coverage_pct"] == 100.0


def test_harvest_survives_a_listing_that_raises(monkeypatch):
    def boom(l, m=6):
        if l["id"] == 1:
            raise RuntimeError("network died")
        return [{"url": "photos/2-0.jpg", "position": 0}]

    monkeypatch.setattr(photos, "harvest_one", boom)
    listings = [{"id": 1, "images": []}, {"id": 2, "images": []}]
    stats = photos.harvest(listings, workers=1)
    assert stats["with_photos"] == 1
    assert listings[0]["images"] == []


def test_harvest_normalises_a_missing_images_key(monkeypatch):
    monkeypatch.setattr(photos, "harvest_one", lambda l, m=6: [])
    listings = [{"id": 1}]
    photos.harvest(listings, workers=1)
    assert listings[0]["images"] == []


# --------------------------------------------------------------------------- #
# Attribute extraction from detail pages
#
# Each feature is an <svg> whose <title> names it, followed by a span with the value.
# --------------------------------------------------------------------------- #
def feature(label: str, value: str) -> str:
    return (
        f'<svg aria-labelledby="x"><title id="x">{label}</title></svg>'
        f'<span class="leading-[-1]">{value}</span>'
    )


def detail_page(*features: str, description: str = "A tidy home in a quiet street.") -> str:
    body = "".join(features)
    return (
        f"<html><body>{body}"
        f'<div data-test="description-content__description">{description}</div>'
        f"</body></html>"
    )


def test_extract_features_reads_labelled_values():
    html = detail_page(
        feature("Bedroom", "3"),
        feature("Bathroom", "1"),
        feature("Garage", "1"),
        feature("Land area", "620m<sup>2</sup>"),
        feature("Floor area", "107m<sup>2</sup>"),
    )
    f = photos.extract_features(html)
    assert f["Bedroom"] == "3"
    assert f["Garage"] == "1"
    assert "620m" in f["Land area"]


def test_extract_features_ignores_navigation_icons():
    """The page has share/nav icons with titles too; only real features count."""
    html = detail_page(feature("mobile navigation", "House"), feature("Garage", "2"))
    f = photos.extract_features(html)
    assert "mobile navigation" not in f
    assert f["Garage"] == "2"


def test_extract_description_returns_the_prose():
    html = detail_page(description="Beautifully renovated three-bedroom home.")
    assert photos.extract_description(html) == "Beautifully renovated three-bedroom home."


def test_extract_description_returns_none_when_absent():
    assert photos.extract_description("<html><body>nothing</body></html>") is None


def test_apply_detail_fields_sets_garage_from_the_feature_count():
    l = {"has_garage": False, "car_spaces": None}
    photos.apply_detail_fields(l, detail_page(feature("Garage", "1")))
    assert l["has_garage"] is True
    assert l["car_spaces"] == 1


def test_a_carport_alone_does_not_count_as_a_garage():
    """The buyer's hard filter is specifically a garage, not any covered parking."""
    l = {"has_garage": False}
    photos.apply_detail_fields(
        l, detail_page(feature("Carport", "2"), description="Carport only, no lock-up.")
    )
    assert l["has_garage"] is False
    assert l["car_spaces"] == 2


def test_garage_mentioned_only_in_prose_is_still_detected():
    l = {"has_garage": False}
    photos.apply_detail_fields(l, detail_page(description="Single garage with internal access."))
    assert l["has_garage"] is True


def test_apply_detail_fields_replaces_the_address_masquerading_as_description():
    l = {"address": "51 Bickerton Street", "description": "51 Bickerton Street"}
    photos.apply_detail_fields(l, detail_page(description="Real prose about the home."))
    assert l["description"] == "Real prose about the home."


def test_apply_detail_fields_fills_missing_areas_only():
    l = {"land_area_m2": None, "floor_area_m2": None}
    photos.apply_detail_fields(
        l, detail_page(feature("Land area", "620m2"), feature("Floor area", "107m2"))
    )
    assert l["land_area_m2"] == 620.0
    assert l["floor_area_m2"] == 107.0
    assert l["enrichment"]["land_area_m2"] == 620.0


def test_apply_detail_fields_does_not_overwrite_known_areas():
    l = {"land_area_m2": 500.0}
    photos.apply_detail_fields(l, detail_page(feature("Land area", "620m2")))
    assert l["land_area_m2"] == 500.0


def test_apply_detail_fields_fills_missing_bed_and_bath_counts():
    l = {"bedrooms": None, "bathrooms": None}
    photos.apply_detail_fields(l, detail_page(feature("Bedroom", "4"), feature("Bathroom", "2")))
    assert l["bedrooms"] == 4
    assert l["bathrooms"] == 2


def test_apply_detail_fields_reports_what_it_changed():
    l = {"has_garage": False}
    updated = photos.apply_detail_fields(l, detail_page(feature("Garage", "1")))
    assert "has_garage" in updated
    assert "description" in updated


def test_apply_detail_fields_is_safe_on_an_empty_page():
    l = {"has_garage": False, "bedrooms": 3}
    assert photos.apply_detail_fields(l, "<html></html>") == []
    assert l["bedrooms"] == 3


def test_parking_totals_combine_garage_carport_and_off_street():
    l = {}
    photos.apply_detail_fields(
        l,
        detail_page(
            feature("Garage", "1"),
            feature("Carport", "1"),
            feature("Off street parking", "2"),
        ),
    )
    assert l["car_spaces"] == 4
    assert l["has_garage"] is True
