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
from dataclasses import dataclass, field

from .base import NormalisedListing, Throttle, detect_garage, parse_int, parse_price

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
    search_url: str  # may use {price_max} and {page}
    base: str
    card: str  # CSS selector for a result tile
    sel: dict  # field -> list of fallback selectors
    browser: str = "chromium"
    property_type: str = "house"
    detail_limit: int = 18  # open this many detail pages for full galleries


# Best-effort configs. Selectors are isolated here so site HTML changes are a
# one-line fix; if a selector misses, that field is simply omitted.
SITES: dict[str, SiteConfig] = {
    "realestate.co.nz": SiteConfig(
        name="realestate.co.nz",
        search_url=(
            "https://www.realestate.co.nz/residential/sale/canterbury/christchurch-city"
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
            "https://www.trademe.co.nz/a/property/residential/sale/canterbury/christchurch-city"
            "/search?price_max={price_max}&sort_order=expirydesc&page={page}"
        ),
        base="https://www.trademe.co.nz",
        card="[class*='tm-property-search-card'], [data-test='listing-card'], article",
        sel={
            "price": ["[class*='price']", "[data-test='price']"],
            "address": ["[class*='address']", "[data-test='address']", "h3"],
            "bedrooms": ["[class*='bedroom']", "[aria-label*='bedroom']"],
            "bathrooms": ["[class*='bathroom']", "[aria-label*='bathroom']"],
            "parking": ["[class*='parking']", "[aria-label*='parking']"],
            "land": ["[class*='land']", "[class*='area']"],
            "desc": ["[class*='subtitle']", "p"],
        },
        browser="firefox",
    ),
    "oneroof.co.nz": SiteConfig(
        name="oneroof.co.nz",
        search_url=(
            "https://www.oneroof.co.nz/for-sale/canterbury/christchurch"
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


def _parse_card(card, cfg: SiteConfig) -> NormalisedListing | None:
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
) -> list[NormalisedListing]:
    """Scrape one site with a given browser engine + rotated signature."""
    try:
        from playwright.sync_api import sync_playwright
    except Exception as exc:  # noqa: BLE001
        log.warning("Playwright unavailable (%s); skipping %s", exc, cfg.name)
        return []

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
                url = cfg.search_url.format(price_max=price_max, page=page_no)
                try:
                    page.goto(url, timeout=45_000, wait_until="domcontentloaded")
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
                for card in cards:
                    item = _parse_card(card, cfg)
                    if item and item.address:
                        results.append(item)

            # Open a bounded number of detail pages for full, filtered house galleries.
            for item in results[: cfg.detail_limit]:
                if not item.url:
                    continue
                try:
                    throttle.wait()
                    page.goto(item.url, timeout=45_000, wait_until="domcontentloaded")
                    page.wait_for_timeout(1800)
                    page.mouse.wheel(0, 3000)
                    page.wait_for_timeout(700)
                    gallery = _collect_house_images(page, limit=6)
                    if gallery:
                        item.images = gallery
                except Exception as exc:  # noqa: BLE001
                    log.debug("%s detail failed for %s: %s", cfg.name, item.url, exc)

            browser.close()
    except Exception as exc:  # noqa: BLE001
        log.warning("%s scrape error: %s", cfg.name, exc)

    log.info("%s: %d listings (engine=%s)", cfg.name, len(results), engine)
    return results
