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


# --------------------------------------------------------------------------- #
# realestate.co.nz search-page extraction
#
# The previous implementation was an HTMLParser state machine that closed each
# listing on an </article> or </li> tag and read fields from data-test="price",
# "address", "bedrooms"… None of that matches the live markup: tiles are
# <div class="tile listing-tile" data-test="tile"> and the field attributes are
# "standard-tile__search-result__address", "price-display__price-method",
# "bedroom", "bathroom". The parser therefore never emitted a single listing —
# silently, because it returned an empty list rather than raising.
#
# This version isolates each tile by splitting on the tile marker, then pulls
# bounded fields out of that slice. Regex over HTML is normally the wrong tool,
# but here it is markedly more robust than the alternative: the state machine
# broke on a div-vs-article change, whereas these patterns only care about the
# data-test attributes, which are the site's own test hooks and change far less
# often than classes or nesting.
# --------------------------------------------------------------------------- #

TILE_MARKER = 'data-test="tile"'

# /43097193/residential/sale/51-bickerton-street-wainoni
HREF_RE = re.compile(r'href="(/(\d{7,})/residential/sale/[^"]*)"')

FIELD_RE = {
    "address": re.compile(
        r'data-test="standard-tile__search-result__address"[^>]*>(.{0,300}?)</', re.S
    ),
    "price_text": re.compile(
        r'data-test="price-display__price-method"[^>]*>(.{0,300}?)</', re.S
    ),
    "bedrooms": re.compile(r'data-test="bedroom"[^>]*>(.{0,200}?)</', re.S),
    "bathrooms": re.compile(r'data-test="bathroom"[^>]*>(.{0,200}?)</', re.S),
    "land_area": re.compile(r'data-test="land-area"[^>]*>(.{0,200}?)</', re.S),
    # The property type has its own element carrying an exact title attribute:
    #   <div … data-test="…features__divider" title="House">House</div>
    # Reading that beats substring-matching the land-area text, where "Townhouse"
    # would also match "house".
    "property_type": re.compile(
        r'data-test="tile__search-result__content__features__divider"[^>]*'
        r'title="([^"]+)"'
    ),
    "description": re.compile(
        r'data-test="tile__search-result__content__description"[^>]*>(.{0,600}?)</', re.S
    ),
}

TAG_RE = re.compile(r"<[^>]+>")
# Photo variants look like ….crop.354x236.jpg?options=compress
IMG_RE = re.compile(
    r"https://mediaserver\.realestate\.co\.nz/listings/\d+/[0-9a-f]{8,}"
    r"\.[a-z0-9-]+\.(\d+)x(\d+)\.jpg(?:\?[^\"'\s]*)?"
)
# Recognised property types, most specific first. Order matters when falling back to
# substring matching: "townhouse" contains "house", so testing "house" first would
# classify every townhouse as a house — and the scoring engine would then rate it 1.0
# instead of 0.45, promoting exactly the stock the buyer ranks lowest.
PROPERTY_TYPES = ("townhouse", "apartment", "lifestyle", "section", "unit", "house")


def _text(fragment: str | None) -> str:
    """Strip tags and collapse whitespace."""
    if not fragment:
        return ""
    return re.sub(r"\s+", " ", TAG_RE.sub(" ", fragment)).strip()


def _leading_int(text: str) -> int | None:
    m = re.match(r"\s*(\d+)", text)
    return int(m.group(1)) if m else None


def _largest_image(tile: str) -> str | None:
    """The biggest photo variant offered in this tile, if any."""
    best: tuple[int, str] | None = None
    for m in IMG_RE.finditer(tile):
        area = int(m.group(1)) * int(m.group(2))
        if best is None or area > best[0]:
            best = (area, m.group(0))
    return best[1] if best else None


def _split_suburb(address: str) -> tuple[str, str | None]:
    """"51 Bickerton Street, WAINONI" -> ("51 Bickerton Street, Wainoni", "Wainoni")."""
    parts = [p.strip() for p in address.split(",") if p.strip()]
    if len(parts) < 2:
        return address, None
    suburb = parts[-1].title() if parts[-1].isupper() else parts[-1]
    return ", ".join(parts[:-1] + [suburb]), suburb


def parse_search_html(html: str) -> list[dict]:
    """Extract one raw dict per listing tile from a search-results page."""
    positions = [m.start() for m in re.finditer(re.escape(TILE_MARKER), html)]
    if not positions:
        return []
    positions.append(len(html))

    out: list[dict] = []
    for i in range(len(positions) - 1):
        tile = html[positions[i]: positions[i + 1]]
        href = HREF_RE.search(tile)
        if not href:
            continue

        item: dict = {"href": href.group(1), "source_id": href.group(2)}
        for key, pattern in FIELD_RE.items():
            m = pattern.search(tile)
            if m:
                item[key] = _text(m.group(1))

        img = _largest_image(tile)
        item["images"] = [img] if img else []
        out.append(item)
    return out


def scrape_realestate_api(
    price_max: int = 1_000_000,
    max_pages: int = 5,
) -> list[NormalisedListing]:
    """Scrape realestate.co.nz search results over plain HTTP (no browser).

    Sorted by ``by=latest`` so each run sees the newest listings first — this is the
    path that keeps the dataset current.

    Two deliberate decisions about price:

    **Filtering happens here, not in the URL.** realestate.co.nz is an Ember app that
    applies price filters client-side, so no query parameter (`price_max`, `price_to`,
    `maxPrice`, `price=0-500000`, …) narrows the server-rendered HTML — every variant
    returns the same unfiltered page. Verified by probing all of them.

    **The default ceiling is well above the buyer's $500k cap, on purpose.** In the
    sub-$500k Christchurch segment essentially *nothing* publishes an asking price —
    it all sells by auction or deadline sale — so capping ingestion at the buyer's
    budget starves the valuation model of the observed prices it calibrates on. A
    listing at $650k with 4 bedrooms on 800m² is still a real observation of how
    bedrooms and land are priced, and in log space it informs the sub-$500k end fine.
    The buyer's actual budget is enforced downstream by the hard filters in
    ``scoring.py``, which is where a *preference* belongs — not in data collection.
    """
    base = "https://www.realestate.co.nz"
    results: list[NormalisedListing] = []
    seen_ids: set[str] = set()
    throttle = Throttle(2.0)

    for page_no in range(1, max_pages + 1):
        throttle.wait()
        url = (
            f"{base}/residential/sale/canterbury/christchurch-city"
            f"?by=latest&page={page_no}"
        )
        html = _fetch(url)
        if not html:
            log.warning("realestate.co.nz: page %d fetch failed", page_no)
            break

        items = parse_search_html(html)
        if not items:
            log.info("realestate.co.nz: no tiles on page %d; stopping", page_no)
            break

        new_on_page = 0
        for item in items:
            source_id = item["source_id"]
            if source_id in seen_ids:
                continue  # pagination overlap
            seen_ids.add(source_id)

            raw_address = item.get("address")
            if not raw_address:
                continue
            address, suburb = _split_suburb(raw_address)

            price_text = item.get("price_text") or None
            price = parse_price(price_text) if price_text else None
            # Only a published figure can breach the ceiling. Unpriced stock is always
            # kept — it is the majority of the market at this price point.
            if price is not None and price > price_max:
                continue

            land = _leading_int(item.get("land_area") or "")
            # Prefer the dedicated type element; fall back to the land-area text.
            type_text = (item.get("property_type") or item.get("land_area") or "").lower()
            ptype = next((t for t in PROPERTY_TYPES if t in type_text), "house")

            desc = item.get("description") or ""
            results.append(NormalisedListing(
                source="realestate.co.nz",
                source_id=source_id,
                url=f"{base}{item['href']}",
                address=address,
                suburb=suburb,
                price=price,
                price_text=price_text,
                bedrooms=_leading_int(item.get("bedrooms") or ""),
                bathrooms=_leading_int(item.get("bathrooms") or ""),
                has_garage=detect_garage(f"{desc} {price_text or ''}", None),
                land_area_m2=float(land) if land else None,
                description=desc or None,
                property_type=ptype,
                images=item.get("images") or [],
            ))
            new_on_page += 1

        log.info(
            "realestate.co.nz: page %d -> %d tiles, %d kept",
            page_no, len(items), new_on_page,
        )

    log.info("realestate.co.nz total: %d listings", len(results))
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
    max_pages: int = 1,  # accepted for a uniform scraper signature; TradeMe is single-page
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
