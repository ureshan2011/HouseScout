"""Shared scraper primitives: normalised data shape, throttling, and text parsing."""
from __future__ import annotations

import re
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime


@dataclass
class NormalisedListing:
    """The shape every scraper must emit; consumed by app.scraper_hook.upsert_listing."""

    source: str
    source_id: str
    url: str | None = None
    address: str | None = None
    suburb: str | None = None
    lat: float | None = None
    lng: float | None = None
    price: float | None = None
    price_text: str | None = None
    bedrooms: int | None = None
    bathrooms: int | None = None
    car_spaces: int | None = None
    has_garage: bool = False
    land_area_m2: float | None = None
    floor_area_m2: float | None = None
    property_type: str | None = None
    description: str | None = None
    agent: str | None = None
    listing_date: datetime | None = None
    images: list[str] = field(default_factory=list)
    enrichment: dict | None = None
    raw_json: dict | None = None

    def to_dict(self) -> dict:
        return asdict(self)


class Throttle:
    """Simple polite rate limiter (min seconds between requests)."""

    def __init__(self, min_interval: float = 2.0):
        self.min_interval = min_interval
        self._last = 0.0

    def wait(self) -> None:
        elapsed = time.monotonic() - self._last
        if elapsed < self.min_interval:
            time.sleep(self.min_interval - elapsed)
        self._last = time.monotonic()


# ----------------------------- parsing helpers ----------------------------- #
_PRICE_RE = re.compile(r"\$?\s*([\d,]+(?:\.\d+)?)")
_GARAGE_RE = re.compile(r"\bgarage\b|\binternal access\b", re.I)


def parse_price(text: str | None) -> float | None:
    """Pull a numeric price from messy strings; returns None for 'by negotiation'/auction."""
    if not text:
        return None
    m = _PRICE_RE.search(text.replace(",", ""))
    if not m:
        return None
    try:
        val = float(m.group(1).replace(",", ""))
    except ValueError:
        return None
    return val if val > 1000 else None  # ignore tiny numbers (e.g. "3 bed")


def detect_garage(text: str | None, car_spaces: int | None) -> bool:
    if car_spaces and car_spaces > 0:
        return True
    return bool(text and _GARAGE_RE.search(text))


def parse_int(text: str | None) -> int | None:
    if not text:
        return None
    m = re.search(r"\d+", str(text))
    return int(m.group()) if m else None
