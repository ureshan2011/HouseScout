"""Multi-source, multi-browser listing scraper framework.

One generic Playwright driver scrapes any configured site with a chosen browser
engine (chromium/firefox/webkit) and a rotated, realistic browser signature
(user-agent, locale, viewport, timezone, light stealth tweaks) to reduce blocking.

Each site yields NormalisedListing rows. House photos are collected generically by
inspecting the rendered <img> elements' *natural* dimensions and dropping agent /
human / logo images — so we keep property pictures, not headshots.

Everything is defensive: any failure logs and returns what it has, so one flaky
site never breaks the others (which run as parallel CI jobs).

⚠️ Personal use only. Honour each site's robots.txt/terms and keep the throttle on.
"""
from __future__ import annotations

import logging
import random
import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Callable

from .base import NormalisedListing, Throttle, detect_garage, parse_int, parse_price
from .regions import DEFAULT_REGION_KEYS, REGIONS, Region

log = logging.getLogger(__name__)

# Realistic recent user-agents per engine (rotated to vary our signature).
USER_AGENTS = {
    "chromium": [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    ],
    "firefox": [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:124.0) Gecko/20100101 Firefox/124.0",
        "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0",
    ],
    "webkit": [
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    ],
}

VIEWPORTS = [(1366, 768), (1440, 900), (1536, 864), (1920, 1080)]

# URL/alt substrings that indicate a non-property image (agent, logo, etc.).
_BLOCK_IMG = (
    "agent", "profile", "staff", "people", "person", "avatar", "headshot", "salesperson",
    "team", "vcard", "logo", "brand", "watermark", "placeholder", "default", "sprite", "icon",
)


@dataclass
class SiteConfig:
    name: str
    search_url: str  # may use {price_max}, {page} and {location}
    base: str
    card: str  # CSS selector for a result tile
    sel: dict  # field -> list of fallback selectors
    browser: str = "chromium"
    property_type: str = "house"
    detail_limit: int = 18  # open this many detail pages for full galleries
    # False for a site whose search path no longer resolves. Kept in the catalogue
    # (the selectors are still the best starting point for repairing it) but skipped
    # by default so it cannot silently consume a CI runner and return nothing.
    enabled: bool = True
    # Tile parser for a site whose tiles the generic per-field CSS selectors cannot
    # read (Trade Me's attributes are unlabelled icons). Signature matches `_parse_card`.
    parse_card: Callable | None = None
    # Reads attributes the tile lacks off an opened detail page: `(page, item) -> None`.
    parse_detail: Callable | None = None

    def location_for(self, region: Region) -> str:
        """This site's location path segment for a district.

        realestate.co.nz and TradeMe both use ``<region>/<district>``, which is exactly
        ``Region.path``. A site with a different scheme overrides this.
        """
        return region.path


_TM_LISTED_RE = re.compile(r"Listed\s+\w+,?\s+(\d{1,2})\s+([A-Za-z]{3})")
_TM_NUM = r"(\d[\d,]*)"


def _trademe_listed_date(text: str | None, today: datetime | None = None) -> datetime | None:
    """'Listed Mon, 12 Oct' -> a datetime. The tile gives no year, so take the latest one
    that is not in the future."""
    m = _TM_LISTED_RE.search(text or "")
    if not m:
        return None
    today = today or datetime.now()
    for year in (today.year, today.year - 1):
        try:
            d = datetime.strptime(f"{m.group(1)} {m.group(2)} {year}", "%d %b %Y")
        except ValueError:
            return None
        if d <= today:
            return d
    return None


def _parse_trademe_card(card, cfg: SiteConfig, region: Region) -> NormalisedListing | None:
    """Parse a Trade Me ``tm-property-premium-listing-card``.

    The bed/bath/area row is unlabelled icons, but the list carries one aria-label that
    spells it out ("2 bedrooms. 1 bathroom. floor area 78 meters square. land area 87
    meters square."), which is what makes floor and land area distinguishable. A part
    the tile lacks is simply absent from the label. Parking is not on the tile.
    """
    try:
        href_el = card.query_selector("a[href]")
        href = href_el.get_attribute("href") if href_el else None
        if not href:
            return None
        path = href.split("?")[0]
        url = path if path.startswith("http") else f"{cfg.base}{path}"
        source_id = path.rstrip("/").split("/")[-1]

        addr_el = card.query_selector("tm-property-search-card-address-subtitle")
        parts = [p.strip() for p in ((addr_el.inner_text() if addr_el else "") or "").split(",")]
        parts = [p for p in parts if p]
        # Trade Me appends the district ("Christchurch City"); our addresses stop at the suburb.
        if len(parts) > 2 and parts[-1].lower().startswith(region.name.lower()):
            parts = parts[:-1]
        address = ", ".join(parts) or None

        label_el = card.query_selector("ul[aria-label]")
        label = (label_el.get_attribute("aria-label") if label_el else "") or ""

        def num(pattern: str) -> int | None:
            m = re.search(pattern, label)
            return int(m.group(1).replace(",", "")) if m else None

        price_text = _txt(card, ["tm-property-search-card-price-attribute"])
        title = _txt(card, ["tm-property-search-card-listing-title"])
        listed = _txt(card, ["tm-property-search-card-listed-date"])
        agent_el = card.query_selector("tm-agent")
        agent = (agent_el.inner_text() or "").strip().split("\n")[0] if agent_el else None

        # The first <img> is the agency logo; the property photo is served from /photoserver/.
        photo = next(
            (
                i.get_attribute("src")
                for i in card.query_selector_all("img")
                if "photoserver" in (i.get_attribute("src") or "")
            ),
            None,
        )

        ptype = cfg.property_type
        if "apartment" in path:
            ptype = "apartment"
        elif "townhouse" in path:
            ptype = "townhouse"

        return NormalisedListing(
            source=cfg.name,
            source_id=source_id,
            url=url,
            address=address,
            region=region.key,
            region_name=region.label,
            price=parse_price(price_text),
            price_text=price_text,
            bedrooms=num(rf"{_TM_NUM}\s+bedroom"),
            bathrooms=num(rf"{_TM_NUM}\s+bathroom"),
            has_garage=detect_garage(title, None),
            land_area_m2=float(v) if (v := num(rf"land area {_TM_NUM}")) else None,
            floor_area_m2=float(v) if (v := num(rf"floor area {_TM_NUM}")) else None,
            description=title,
            agent=agent,
            listing_date=_trademe_listed_date(listed),
            property_type=ptype,
            images=[photo] if photo else [],
            raw_json={"href": path, "listed": listed},
        )
    except Exception as exc:  # noqa: BLE001
        log.debug("trademe card parse failed: %s", exc)
        return None



_TM_STAT_RE = {
    "watchlisted": re.compile(r"([\d,]+)\s*\n\s*Watchlisted"),
    "days_on_site": re.compile(r"([\d,]+)\s*\n\s*Days on site"),
}
_TM_DESC_END = ("Source: Please be aware", "No updates from the agent", "Local Schools")


def _parse_trademe_detail(page, item: NormalisedListing) -> None:
    """Fill the garage flag, description and demand stats (watchlist count, days on site) from a Trade Me listing page.

    The tile has no parking field and the page has no structured one either: parking is
    only ever mentioned in the agent's prose, so the description is what feeds
    `detect_garage`. It sits between the details block and a "Source:" disclaimer; the
    window stops there so other listings' text further down the page cannot leak in.
    """
    text = page.inner_text("body")
    marker = "Ask about this image"
    start = text.find(marker)
    if start != -1:
        ends = [i for i in (text.find(e, start) for e in _TM_DESC_END) if i != -1]
        end = min(ends) if ends else start + 6000
        prose = "\n".join(
            ln.strip() for ln in text[start:end].splitlines()
            if ln.strip() and ln.strip() != marker
        )
        if prose:
            item.description = prose[:4000]
            item.has_garage = item.has_garage or detect_garage(prose, None)
    stats = {}
    for key, rx in _TM_STAT_RE.items():
        m = rx.search(text)
        if m:
            stats[key] = int(m.group(1).replace(",", ""))
    if stats:
        item.raw_json = {**(item.raw_json or {}), **stats}


# Best-effort configs. Selectors are isolated here so site HTML changes are a
# one-line fix; if a selector misses, that field is simply omitted.
SITES: dict[str, SiteConfig] = {
    "realestate.co.nz": SiteConfig(
        name="realestate.co.nz",
        search_url=(
            "https://www.realestate.co.nz/residential/sale/{location}"
            "?price_max={price_max}&by=latest&page={page}"
        ),
        base="https://www.realestate.co.nz",
        card="[data-test='tile'], article, li[class*='tile']",
        sel={
            "price": ["[data-test='price']", "[class*='price']"],
            "address": ["[data-test='address']", "h3", "[class*='address']"],
            "bedrooms": ["[data-test='bedrooms']", "[aria-label*='bedroom']"],
            "bathrooms": ["[data-test='bathrooms']", "[aria-label*='bathroom']"],
            "parking": ["[data-test='parking']", "[aria-label*='parking']"],
            "land": ["[data-test='land-area']", "[class*='land']"],
            "desc": ["[data-test='description']", "p"],
        },
        browser="chromium",
    ),
    "trademe.co.nz": SiteConfig(
        name="trademe.co.nz",
        search_url=(
            "https://www.trademe.co.nz/a/property/residential/sale/{location}"
            "/search?price_max={price_max}&sort_order=expirydesc&page={page}"
        ),
        base="https://www.trademe.co.nz",
        # Tiles are <tm-property-premium-listing-card> custom elements with no per-field
        # classes, so they are read by `_parse_trademe_card`, not by the `sel` table.
        card="tm-property-premium-listing-card",
        sel={},
        parse_card=_parse_trademe_card,
        parse_detail=_parse_trademe_detail,
        detail_limit=200,  # parking is only on the detail page, and the garage filter needs it
        browser="firefox",
    ),
    # DISABLED: the configured search path no longer exists. Probed 2026-08: the site
    # root returns 200 but `/for-sale/canterbury/christchurch`, `/for-sale/...-city` and
    # `/for-sale` itself all return 404, so this config has been scraping nothing —
    # every CI run spent a runner on it and uploaded an empty partial. Re-enable once
    # someone re-derives the current search URL and confirms the selectors below.
    "oneroof.co.nz": SiteConfig(
        name="oneroof.co.nz",
        enabled=False,
        search_url=(
            "https://www.oneroof.co.nz/for-sale/{location}"
            "?maxPrice={price_max}&page={page}"
        ),
        base="https://www.oneroof.co.nz",
        card="[class*='listing-card'], [class*='property-card'], article",
        sel={
            "price": ["[class*='price']"],
            "address": ["[class*='address']", "h2", "h3"],
            "bedrooms": ["[class*='bed']", "[aria-label*='bed']"],
            "bathrooms": ["[class*='bath']", "[aria-label*='bath']"],
            "parking": ["[class*='park']", "[class*='car']"],
            "land": ["[class*='land']", "[class*='floor']"],
            "desc": ["[class*='description']", "p"],
        },
        browser="chromium",
    ),
}


def _ua(engine: str) -> str:
    return random.choice(USER_AGENTS.get(engine, USER_AGENTS["chromium"]))


def _txt(card, selectors: list[str]) -> str | None:
    for s in selectors:
        try:
            el = card.query_selector(s)
            if el:
                t = (el.inner_text() or "").strip()
                if t:
                    return t
        except Exception:  # noqa: BLE001
            continue
    return None


def _good_image(src: str | None, alt: str | None, w: int, h: int) -> bool:
    """Keep landscape-ish property photos; drop tiny icons and square headshots/logos."""
    if not src or not src.startswith("http"):
        return False
    blob = f"{src} {alt or ''}".lower()
    if any(k in blob for k in _BLOCK_IMG):
        return False
    if w < 320 or h < 220:
        return False
    ratio = w / h if h else 0
    # Square-ish and not large -> almost always an agent headshot or logo.
    if 0.8 <= ratio <= 1.25 and max(w, h) < 520:
        return False
    return True


def _collect_house_images(page, limit: int = 6) -> list[str]:
    """Generic house-photo extractor: rank rendered <img> by natural area, filter people."""
    try:
        imgs = page.eval_on_selector_all(
            "img",
            "els => els.map(e => ({src: e.currentSrc || e.src, alt: e.alt || '',"
            " w: e.naturalWidth || 0, h: e.naturalHeight || 0}))",
        )
    except Exception:  # noqa: BLE001
        return []
    good = [i for i in imgs if _good_image(i.get("src"), i.get("alt"), i.get("w", 0), i.get("h", 0))]
    good.sort(key=lambda i: i.get("w", 0) * i.get("h", 0), reverse=True)
    seen, out = set(), []
    for i in good:
        src = i["src"].split("?")[0]
        if src in seen:
            continue
        seen.add(src)
        out.append(i["src"])
        if len(out) >= limit:
            break
    return out


def _parse_card(card, cfg: SiteConfig, region: Region) -> NormalisedListing | None:
    try:
        href_el = card.query_selector("a[href]")
        href = href_el.get_attribute("href") if href_el else None
        if not href:
            return None
        url = href if href.startswith("http") else f"{cfg.base}{href}"
        source_id = href.rstrip("/").split("/")[-1]

        price_text = _txt(card, cfg.sel.get("price", []))
        address = _txt(card, cfg.sel.get("address", []))
        beds = parse_int(_txt(card, cfg.sel.get("bedrooms", [])))
        baths = parse_int(_txt(card, cfg.sel.get("bathrooms", [])))
        cars = parse_int(_txt(card, cfg.sel.get("parking", [])))
        land = parse_int(_txt(card, cfg.sel.get("land", [])))
        desc = _txt(card, cfg.sel.get("desc", []))

        img_el = card.query_selector("img")
        thumb = img_el.get_attribute("src") if img_el else None
        imgs = [thumb] if thumb and thumb.startswith("http") else []

        return NormalisedListing(
            source=cfg.name,
            source_id=source_id,
            url=url,
            address=address,
            region=region.key,
            region_name=region.label,
            price=parse_price(price_text),
            price_text=price_text,
            bedrooms=beds,
            bathrooms=baths,
            car_spaces=cars,
            has_garage=detect_garage(f"{desc or ''} {price_text or ''}", cars),
            land_area_m2=float(land) if land else None,
            description=desc,
            property_type=cfg.property_type,
            images=imgs,
            raw_json={"href": href},
        )
    except Exception as exc:  # noqa: BLE001
        log.debug("card parse failed: %s", exc)
        return None


def scrape_site(
    cfg: SiteConfig,
    price_max: int = 500_000,
    max_pages: int = 4,
    browser_engine: str | None = None,
    region: Region | str | None = None,
) -> list[NormalisedListing]:
    """Scrape one site's district with a given browser engine + rotated signature."""
    if not cfg.enabled:
        log.warning("%s is disabled (dead search URL); skipping", cfg.name)
        return []
    try:
        from playwright.sync_api import sync_playwright
    except Exception as exc:  # noqa: BLE001
        log.warning("Playwright unavailable (%s); skipping %s", exc, cfg.name)
        return []

    if isinstance(region, Region):
        reg = region
    elif isinstance(region, str) and region.strip().lower() in REGIONS:
        reg = REGIONS[region.strip().lower()]
    else:
        reg = REGIONS[DEFAULT_REGION_KEYS[0]]

    engine = browser_engine or cfg.browser
    ua = _ua(engine)
    vw, vh = random.choice(VIEWPORTS)
    results: list[NormalisedListing] = []
    throttle = Throttle(2.5)

    try:
        with sync_playwright() as p:
            launcher = getattr(p, engine, p.chromium)
            browser = launcher.launch(headless=True)
            context = browser.new_context(
                user_agent=ua,
                locale="en-NZ",
                timezone_id="Pacific/Auckland",
                viewport={"width": vw, "height": vh},
            )
            # Light stealth so headless looks less automated.
            context.add_init_script(
                "Object.defineProperty(navigator,'webdriver',{get:()=>undefined});"
                "Object.defineProperty(navigator,'languages',{get:()=>['en-NZ','en']});"
                "Object.defineProperty(navigator,'plugins',{get:()=>[1,2,3]});"
            )
            page = context.new_page()

            for page_no in range(1, max_pages + 1):
                throttle.wait()
                url = cfg.search_url.format(
                    price_max=price_max, page=page_no, location=cfg.location_for(reg)
                )
                try:
                    page.goto(url, timeout=45_000, wait_until="domcontentloaded")
                    try:
                        # Client-rendered sites (Trade Me) fill the tiles in seconds after load.
                        page.wait_for_selector(cfg.card, timeout=20_000)
                    except Exception:  # noqa: BLE001 - no tiles: the cards check below reports it
                        pass
                    page.wait_for_timeout(2000)
                    page.mouse.wheel(0, 4000)  # trigger lazy-loaded tiles
                    page.wait_for_timeout(800)
                except Exception as exc:  # noqa: BLE001
                    log.warning("%s: failed to load %s: %s", cfg.name, url, exc)
                    break
                cards = page.query_selector_all(cfg.card)
                if not cards:
                    log.info("%s: no cards on page %d (blocked or selector drift)", cfg.name, page_no)
                    break
                parse = cfg.parse_card or _parse_card
                for card in cards:
                    item = parse(card, cfg, reg)
                    if item and item.address:
                        results.append(item)

            # Open a bounded number of detail pages for full, filtered house galleries.
            for item in results[: cfg.detail_limit]:
                if not item.url:
                    continue
                try:
                    throttle.wait()
                    page.goto(item.url, timeout=45_000, wait_until="domcontentloaded")
                    if cfg.parse_detail:
                        try:
                            page.wait_for_selector("text=Days on site", timeout=15_000)
                        except Exception:  # noqa: BLE001 - parse what rendered
                            pass
                    page.wait_for_timeout(1800)
                    page.mouse.wheel(0, 3000)
                    page.wait_for_timeout(700)
                    gallery = _collect_house_images(page, limit=6)
                    if gallery:
                        item.images = gallery
                    if cfg.parse_detail:
                        cfg.parse_detail(page, item)
                except Exception as exc:  # noqa: BLE001
                    log.debug("%s detail failed for %s: %s", cfg.name, item.url, exc)

            browser.close()
    except Exception as exc:  # noqa: BLE001
        log.warning("%s scrape error: %s", cfg.name, exc)

    log.info("%s/%s: %d listings (engine=%s)", cfg.name, reg.key, len(results), engine)
    return results
