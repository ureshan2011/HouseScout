"""realestate.co.nz scraper (Playwright).

Christchurch residential, price <= cap. Defensive by design: if Playwright is not
installed or the network/site is unavailable, it logs and returns an empty list so
the rest of the pipeline keeps working.

⚠️ Personal use only. Honour robots.txt and the site's terms, throttle requests,
and do not redistribute scraped data. Selectors are isolated here so site HTML
changes only require edits in one place.
"""
from __future__ import annotations

import logging

from .base import NormalisedListing, Throttle, detect_garage, parse_int, parse_price

log = logging.getLogger(__name__)

SOURCE = "realestate.co.nz"
SEARCH_URL = (
    "https://www.realestate.co.nz/residential/sale/canterbury/christchurch-city"
    "?price_max={price_max}&by=latest"
)


def scrape(price_max: int = 500_000, max_pages: int = 3) -> list[NormalisedListing]:
    try:
        from playwright.sync_api import sync_playwright
    except Exception as exc:  # noqa: BLE001
        log.warning("Playwright not available (%s); skipping %s", exc, SOURCE)
        return []

    results: list[NormalisedListing] = []
    throttle = Throttle(2.5)
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page(user_agent="HouseScout/0.1 (personal use)")
            for page_no in range(1, max_pages + 1):
                throttle.wait()
                url = SEARCH_URL.format(price_max=price_max) + f"&page={page_no}"
                try:
                    page.goto(url, timeout=45_000, wait_until="domcontentloaded")
                    page.wait_for_timeout(1500)
                except Exception as exc:  # noqa: BLE001
                    log.warning("Failed to load %s: %s", url, exc)
                    break
                cards = page.query_selector_all("[data-test='tile']")
                if not cards:
                    break
                for card in cards:
                    item = _parse_card(card)
                    if item:
                        results.append(item)
            browser.close()
    except Exception as exc:  # noqa: BLE001
        log.warning("%s scrape error: %s", SOURCE, exc)
    return results


def _parse_card(card) -> NormalisedListing | None:
    """Extract a listing from a search-result tile. Selectors centralised here."""
    try:
        def txt(sel: str) -> str | None:
            el = card.query_selector(sel)
            return el.inner_text().strip() if el else None

        href_el = card.query_selector("a[href]")
        href = href_el.get_attribute("href") if href_el else None
        if not href:
            return None
        source_id = href.rstrip("/").split("/")[-1]
        url = href if href.startswith("http") else f"https://www.realestate.co.nz{href}"

        price_text = txt("[data-test='price']")
        address = txt("[data-test='address']") or txt("h3")
        beds = parse_int(txt("[data-test='bedrooms']"))
        baths = parse_int(txt("[data-test='bathrooms']"))
        cars = parse_int(txt("[data-test='parking']"))
        land = parse_int(txt("[data-test='land-area']"))
        desc = txt("[data-test='description']")

        img_el = card.query_selector("img")
        img = img_el.get_attribute("src") if img_el else None

        return NormalisedListing(
            source=SOURCE,
            source_id=source_id,
            url=url,
            address=address,
            price=parse_price(price_text),
            price_text=price_text,
            bedrooms=beds,
            bathrooms=baths,
            car_spaces=cars,
            has_garage=detect_garage(f"{desc or ''} {price_text or ''}", cars),
            land_area_m2=float(land) if land else None,
            description=desc,
            property_type="house",
            images=[img] if img else [],
            raw_json={"href": href},
        )
    except Exception as exc:  # noqa: BLE001
        log.debug("Card parse failed: %s", exc)
        return None
