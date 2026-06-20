"""Tests for money parsing and homes/OneRoof estimate extraction (no network)."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scraper.base import parse_money_range  # noqa: E402
from scraper.homes import _extract as homes_extract  # noqa: E402
from scraper.oneroof import _extract as oneroof_extract  # noqa: E402


def test_parse_money_range_single_and_range():
    assert parse_money_range("$465,000") == 465_000
    assert parse_money_range("$650,000 - $710,000") == 680_000
    assert parse_money_range("by negotiation") is None


def test_homes_extract_labelled_values():
    html = """
    <div><span>HomesEstimate</span><span>$520,000</span></div>
    <div><span>Capital Value</span><span>$470,000</span></div>
    <div><span>Rental estimate</span><span>$560 per week</span></div>
    """
    data = homes_extract(html)
    assert data["estimate_value"] == 520_000
    assert data["rateable_value"] == 470_000
    assert data["rental_estimate_weekly"] == 560


def test_oneroof_extract_labelled_values():
    html = """
    <div><p>OneRoof Estimate</p><p>$505,000</p></div>
    <div><p>Rateable Value</p><p>$455,000</p></div>
    """
    data = oneroof_extract(html)
    assert data["estimate_value"] == 505_000
    assert data["rateable_value"] == 455_000
