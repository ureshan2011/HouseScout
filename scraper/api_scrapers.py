"""API-based scrapers that work without Playwright (no browser needed).

These are lightweight HTTP scrapers that run fast, use less memory, and work
in any CI runner without browser installation. They complement the Playwright
scrapers by providing a fallback when browser-based scraping gets blocked.

Each scraper returns NormalisedListing rows, same as the Playwright versions.
"""
from __future__ import annotations

import json
import logging
import re
import urllib.request
import urllib.error
from html.parser import HTMLParser

from .base import NormalisedListing, Throttle, detect_garage, parse_int, parse_price

log = logging.getLogger(__name__)

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
]


def _fetch(url: str, timeout: int = 30) -> str | None:
    import random
    ua = random.choice(USER_AGENTS)
    try:
        req = urllib.request.Request(url, headers={
            "User-Agent": ua,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-NZ,en;q=0.9",
        })
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read().decode("utf-8", errors="replace")
    except Exception as e:
        log.warning("fetch failed %s: %s", url, e)
        return None


class _RealestateHTMLParser(HTMLParser):
    """Minimal HTML parser to extract listing data from realestate.co.nz search pages."""

    def __init__(self):
        super().__init__()
        self.listings: list[dict] = []
        self._in_card = False
        self._current: dict = {}
        self._capture_field: str | None = None
        self._capture_buf: str = ""

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]):
        attr_dict = dict(attrs)
        data_test = attr_dict.get("data-test", "")

        if data_test == "tile" or (tag == "article" and "tile" in (attr_dict.get("class", ""))):
            self._in_card = True
            self._current = {}

        if self._in_card:
            if tag == "a" and attr_dict.get("href", "").startswith("/"):
                href = attr_dict["href"]
                if "/residential/sale/" in href:
                    self._current["href"] = href
                    self._current["source_id"] = href.rstrip("/").split("/")[1] if "/" in href else href

            if data_test in ("price", "address", "bedrooms", "bathrooms", "parking", "land-area", "description"):
                self._capture_field = data_test
                self._capture_buf = ""

            if tag == "img" and "images" not in self._current:
                src = attr_dict.get("src", "")
                if src.startswith("http") and "mediaserver" in src:
                    self._current["images"] = [src]

    def handle_data(self, data: str):
        if self._capture_field:
            self._capture_buf += data

    def handle_endtag(self, tag: str):
        if self._capture_field and tag in ("span", "div", "p", "h3", "h2"):
            text = self._capture_buf.strip()
            if text:
                field_map = {
                    "price": "price_text",
                    "address": "address",
                    "bedrooms": "bedrooms",
                    "bathrooms": "bathrooms",
                    "parking": "parking",
                    "land-area": "land_area",
                    "description": "description",
                }
                key = field_map.get(self._capture_field, self._capture_field)
                self._current[key] = text
            self._capture_field = None
            self._capture_buf = ""

        if tag in ("article", "li") and self._in_card and self._current.get("href"):
            self.listings.append(self._current)
            self._current = {}
            self._in_card = False


def scrape_realestate_api(
    price_max: int = 500_000,
    max_pages: int = 5,
) -> list[NormalisedListing]:
    """Scrape realestate.co.nz using plain HTTP (no browser)."""
    base = "https://www.realestate.co.nz"
    results: list[NormalisedListing] = []
    throttle = Throttle(2.0)

    for page_no in range(1, max_pages + 1):
        throttle.wait()
        url = (
            f"{base}/residential/sale/canterbury/christchurch-city"
            f"?price_max={price_max}&by=latest&page={page_no}"
        )
        html = _fetch(url)
        if not html:
            break

        parser = _RealestateHTMLParser()
        try:
            parser.feed(html)
        except Exception as e:
            log.warning("HTML parse error page %d: %s", page_no, e)
            break

        if not parser.listings:
            log.info("realestate.co.nz API: no listings on page %d", page_no)
            break

        for item in parser.listings:
            href = item.get("href", "")
            address = item.get("address")
            if not address:
                continue

            price_text = item.get("price_text")
            beds = parse_int(item.get("bedrooms"))
            baths = parse_int(item.get("bathrooms"))
            cars = parse_int(item.get("parking"))
            land = parse_int(item.get("land_area"))
            desc = item.get("description", "")
            imgs = item.get("images", [])

            results.append(NormalisedListing(
                source="realestate.co.nz",
                source_id=item.get("source_id", href.split("/")[1] if "/" in href else ""),
                url=f"{base}{href}" if not href.startswith("http") else href,
                address=address,
                suburb=_suburb_from_address(address),
                price=parse_price(price_text),
                price_text=price_text,
                bedrooms=beds,
                bathrooms=baths,
                car_spaces=cars,
                has_garage=detect_garage(f"{desc} {price_text or ''}", cars),
                land_area_m2=float(land) if land else None,
                description=desc or None,
                property_type="house",
                images=imgs,
            ))

        log.info("realestate.co.nz API page %d: %d cards", page_no, len(parser.listings))

    log.info("realestate.co.nz API total: %d listings", len(results))
    return results


def _suburb_from_address(address: str | None) -> str | None:
    if not address:
        return None
    parts = [p.strip() for p in address.split(",") if p.strip()]
    if len(parts) >= 2:
        return parts[-1]
    words = address.split()
    return words[-1] if words else None


def scrape_trademe_rss(
    price_max: int = 500_000,
) -> list[NormalisedListing]:
    """Try TradeMe's property search via their public pages.

    TradeMe requires JS rendering for full content, but their search pages
    sometimes include structured data (JSON-LD) that we can parse without
    a browser. This is a best-effort approach.
    """
    results: list[NormalisedListing] = []
    url = (
        "https://www.trademe.co.nz/a/property/residential/sale/canterbury"
        f"/christchurch-city/search?price_max={price_max}&sort_order=expirydesc"
    )

    html = _fetch(url)
    if not html:
        log.info("trademe: could not fetch search page (JS required)")
        return results

    json_ld_pattern = re.compile(r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>', re.DOTALL)
    for match in json_ld_pattern.finditer(html):
        try:
            data = json.loads(match.group(1))
            if isinstance(data, dict) and data.get("@type") == "ItemList":
                for item in data.get("itemListElement", []):
                    thing = item.get("item", {})
                    if thing.get("@type") == "Product":
                        name = thing.get("name", "")
                        url_str = thing.get("url", "")
                        price_val = None
                        offers = thing.get("offers", {})
                        if offers.get("price"):
                            price_val = float(offers["price"])
                        results.append(NormalisedListing(
                            source="trademe.co.nz",
                            source_id=url_str.split("/")[-1] if url_str else "",
                            url=url_str,
                            address=name,
                            suburb=_suburb_from_address(name),
                            price=price_val,
                            price_text=offers.get("priceCurrency", "NZD") + f" {price_val}" if price_val else None,
                            property_type="house",
                        ))
        except (json.JSONDecodeError, KeyError, TypeError):
            continue

    next_data_match = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.DOTALL)
    if next_data_match:
        try:
            next_data = json.loads(next_data_match.group(1))
            props = next_data.get("props", {}).get("pageProps", {})
            search_results = props.get("searchResults", props.get("listings", []))
            if isinstance(search_results, list):
                for item in search_results:
                    address = item.get("address", item.get("title", ""))
                    if not address:
                        continue
                    results.append(NormalisedListing(
                        source="trademe.co.nz",
                        source_id=str(item.get("listingId", item.get("id", ""))),
                        url=f"https://www.trademe.co.nz/a/property/{item.get('listingId', '')}",
                        address=address,
                        suburb=item.get("suburb") or _suburb_from_address(address),
                        price=item.get("priceAmount") or parse_price(item.get("priceDisplay")),
                        price_text=item.get("priceDisplay"),
                        bedrooms=item.get("bedrooms"),
                        bathrooms=item.get("bathrooms"),
                        car_spaces=item.get("parking"),
                        has_garage=bool(item.get("parking")),
                        land_area_m2=item.get("landArea"),
                        description=item.get("subtitle") or item.get("description"),
                        property_type=item.get("propertyType", "house"),
                        images=[item["pictureHref"]] if item.get("pictureHref") else [],
                    ))
        except (json.JSONDecodeError, KeyError, TypeError) as e:
            log.debug("trademe __NEXT_DATA__ parse: %s", e)

    log.info("trademe API: %d listings", len(results))
    return results


ALL_API_SCRAPERS = {
    "realestate.co.nz": scrape_realestate_api,
    "trademe.co.nz": scrape_trademe_rss,
}
