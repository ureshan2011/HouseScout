"""OneRoof (oneroof.co.nz) enrichment: estimate value, RV, sold prices.

Same contract as homes.py: `enrich(address) -> dict | None`, Playwright-based and
fully defensive. Used as a second opinion / fallback to homes.co.nz estimates.

⚠️ Personal use; throttle and honour the site's terms. Estimates are indicative.
"""
from __future__ import annotations

import logging

from .base import Throttle, parse_money_range, parse_rent

log = logging.getLogger(__name__)

SOURCE = "oneroof.co.nz"
SEARCH_URL = "https://www.oneroof.co.nz/estimate?q={q}"

_LABELS = {
    "oneroof estimate": "estimate_value",
    "estimated value": "estimate_value",
    "estimate": "estimate_value",
    "rateable value": "rateable_value",
    "capital value": "rateable_value",
    "rv": "rateable_value",
    "rental estimate": "rental_estimate_weekly",
    "last sold": "last_sold_price",
    "sold for": "last_sold_price",
}


def enrich(address: str, throttle: Throttle | None = None) -> dict | None:
    if not address:
        return None
    try:
        from playwright.sync_api import sync_playwright
    except Exception as exc:  # noqa: BLE001
        log.warning("Playwright not available (%s); skipping %s", exc, SOURCE)
        return None

    throttle = throttle or Throttle(3.0)
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page(user_agent="HouseScout/0.1 (personal use)")
            try:
                throttle.wait()
                page.goto(SEARCH_URL.format(q=address.replace(" ", "%20")),
                          timeout=45_000, wait_until="domcontentloaded")
                page.wait_for_timeout(2500)
                first = page.query_selector("a[href*='/property/']")
                if first:
                    throttle.wait()
                    first.click()
                    page.wait_for_timeout(2500)
                return _extract(page.content()) or None
            finally:
                browser.close()
    except Exception as exc:  # noqa: BLE001
        log.warning("%s enrich failed for %s: %s", SOURCE, address, exc)
        return None


def _extract(html: str) -> dict:
    from selectolax.parser import HTMLParser

    tree = HTMLParser(html)
    blocks = [n.text(strip=True) for n in tree.css("div,span,p,li") if n.text(strip=True)]
    out: dict = {}
    def value_of(text: str, field: str) -> float | None:
        return parse_rent(text) if field == "rental_estimate_weekly" else parse_money_range(text)

    for i, block in enumerate(blocks):
        low = block.lower()
        for label, field in _LABELS.items():
            if label in low and field not in out:
                val = value_of(block, field)
                if val is None and i + 1 < len(blocks):
                    val = value_of(blocks[i + 1], field)
                if val:
                    out[field] = val
    return out
