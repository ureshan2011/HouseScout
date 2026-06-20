"""homes.co.nz enrichment: estimate value, RV, rental estimate and last sale.

Used to enrich already-scraped listings by address (parallels LINZ land-area).
Playwright-based and fully defensive: any failure returns None so the pipeline
keeps running. Selectors are centralised and may need updating as the site evolves.

⚠️ Personal use; throttle and honour the site's terms. Estimates are indicative.
"""
from __future__ import annotations

import logging

from .base import Throttle, parse_money_range, parse_rent

log = logging.getLogger(__name__)

SOURCE = "homes.co.nz"
SEARCH_URL = "https://homes.co.nz/search?location={q}"

# Label -> enrichment field. Matched case-insensitively against on-page text labels.
_LABELS = {
    "homesestimate": "estimate_value",
    "estimate": "estimate_value",
    "capital value": "rateable_value",
    "rating value": "rateable_value",
    "rateable value": "rateable_value",
    "rental estimate": "rental_estimate_weekly",
    "rent estimate": "rental_estimate_weekly",
    "last sold": "last_sold_price",
}


def _new_browser(p):
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_page(user_agent="HouseScout/0.1 (personal use)")
    return browser, ctx


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
            browser, page = _new_browser(p)
            try:
                throttle.wait()
                page.goto(SEARCH_URL.format(q=address.replace(" ", "%20")),
                          timeout=45_000, wait_until="domcontentloaded")
                page.wait_for_timeout(2500)
                # Open the first property result if present.
                first = page.query_selector("a[href*='/address/']")
                if first:
                    throttle.wait()
                    first.click()
                    page.wait_for_timeout(2500)
                data = _extract(page.content())
                return data or None
            finally:
                browser.close()
    except Exception as exc:  # noqa: BLE001
        log.warning("%s enrich failed for %s: %s", SOURCE, address, exc)
        return None


def _extract(html: str) -> dict:
    """Pull labelled dollar values out of the property page HTML."""
    from selectolax.parser import HTMLParser

    tree = HTMLParser(html)
    text_blocks = [n.text(strip=True) for n in tree.css("div,span,p,li") if n.text(strip=True)]
    out: dict = {}
    def value_of(text: str, field: str) -> float | None:
        return parse_rent(text) if field == "rental_estimate_weekly" else parse_money_range(text)

    for i, block in enumerate(text_blocks):
        low = block.lower()
        for label, field in _LABELS.items():
            if label in low and field not in out:
                # Prefer a value inside the same block; only then look at the next one.
                val = value_of(block, field)
                if val is None and i + 1 < len(text_blocks):
                    val = value_of(text_blocks[i + 1], field)
                if val:
                    out[field] = val
    return out
