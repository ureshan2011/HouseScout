#!/usr/bin/env python3
"""Build listings.json from multiple scraping strategies.

Runners, merged and deduped:
  0. Live HTTP scrapers (``scraper/api_scrapers.py``) — current listings, newest first.
  1. Partial files written by the CI Playwright jobs, when they get through.

**Only real scraped listings.** There is deliberately no seed or sample fallback. This
script previously carried ~700 lines of hand-written listings plus a companion
(``expand_listings.py``) that invented prices from suburb bands, coordinates by hashing
the address, and rateable values as fixed multiples of the invented price — all
rendered next to real street addresses. If every source fails the output is an empty
file and the site shows an empty state, which is the honest result.

Ingestion deliberately reaches above the buyer's $500k cap: in that segment almost
nothing publishes an asking price, and observed prices are what the valuation model
calibrates on. The budget is applied downstream by the hard filters in scoring.py.

Usage:
  python scripts/build_listings.py              # full pipeline
  python scripts/build_listings.py --seed-only  # just write seed data
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
PUBLIC_DIR = REPO_ROOT / "frontend" / "public"
PARTIAL_DIR = PUBLIC_DIR / "partials"
OUT_JSON = PUBLIC_DIR / "listings.json"

sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "scripts"))


def norm_address(a: str | None) -> str:
    if not a:
        return ""
    a = a.lower()
    a = re.sub(
        r"\b(street|st|road|rd|avenue|ave|drive|dr|lane|ln|place|pl|crescent|cres|"
        r"terrace|tce|court|ct|christchurch|canterbury|new zealand|nz)\b", "", a,
    )
    return re.sub(r"[^a-z0-9]", "", a)


def richness(l: dict) -> int:
    score = 0
    score += min(len(l.get("images") or []), 6) * 3
    for k in ("price", "bedrooms", "bathrooms", "land_area_m2", "suburb", "description"):
        if l.get(k):
            score += 1
    return score


def dedupe_and_number(listings: list[dict]) -> list[dict]:
    best: dict[str, dict] = {}
    for l in listings:
        key = norm_address(l.get("address")) or f"{l.get('source')}:{l.get('source_id')}"
        if key not in best or richness(l) > richness(best[key]):
            best[key] = l
    merged = list(best.values())
    merged.sort(key=lambda l: (-richness(l), l.get("price") or 9_999_999))
    for i, l in enumerate(merged, start=1):
        l["id"] = i
    return merged


def suburb_from_address(address: str | None) -> str | None:
    if not address:
        return None
    parts = [p.strip() for p in address.split(",") if p.strip()]
    return parts[-1] if len(parts) >= 1 else None


def fetch_url(url: str, timeout: int = 30) -> str | None:
    try:
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "text/html,application/json",
        })
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read().decode("utf-8", errors="replace")
    except Exception as e:
        print(f"  ! fetch failed {url}: {e}")
        return None


def load_partials() -> list[dict]:
    """Load any existing partial files from CI scrape jobs."""
    listings: list[dict] = []
    if PARTIAL_DIR.exists():
        for f in sorted(PARTIAL_DIR.glob("*.json")):
            try:
                data = json.loads(f.read_text())
                if isinstance(data, list):
                    listings.extend(data)
                    print(f"  + partials/{f.name}: {len(data)} listings")
            except Exception as e:
                print(f"  ! skip {f.name}: {e}")
    return listings


def run_api_scrapers() -> list[dict]:
    """Fetch current listings over plain HTTP (no browser).

    This is the path that keeps the dataset fresh. It was previously dead code:
    `scraper/api_scrapers.py` defined the scrapers but nothing ever imported them, so
    every build re-emitted the same hardcoded seed list no matter how often the cron
    fired.

    Failure is non-fatal, but there is no longer a fabricated fallback behind it — a
    blocked source now means fewer (or zero) listings, not invented ones.
    """
    try:
        from scraper.api_scrapers import ALL_API_SCRAPERS
    except Exception as exc:  # noqa: BLE001
        print(f"  ! could not import API scrapers ({exc})")
        return []

    price_max = int(os.environ.get("SCRAPE_PRICE_CEILING", "1000000"))
    max_pages = int(os.environ.get("SCRAPE_MAX_PAGES", "12"))

    out: list[dict] = []
    with ThreadPoolExecutor(max_workers=len(ALL_API_SCRAPERS) or 1) as pool:
        futures = {
            pool.submit(fn, price_max=price_max, max_pages=max_pages): name
            for name, fn in ALL_API_SCRAPERS.items()
        }
        for future in as_completed(futures):
            name = futures[future]
            try:
                items = future.result()
            except Exception as exc:  # noqa: BLE001
                print(f"  ! {name}: failed ({exc})")
                continue
            mapped = [_from_normalised(it) for it in items if it.address]
            out.extend(mapped)
            print(f"  -> {name}: {len(mapped)} listings")
    return out


def _from_normalised(item) -> dict:
    """Convert a scraper NormalisedListing into the listings.json record shape."""
    d = item.to_dict()
    enr = d.get("enrichment") or {}
    return {
        "id": 0,  # assigned by dedupe_and_number
        "source": d.get("source"),
        "source_id": d.get("source_id"),
        "url": d.get("url"),
        "address": d.get("address"),
        "suburb": d.get("suburb"),
        "lat": d.get("lat"),
        "lng": d.get("lng"),
        # None when the listing publishes no figure (auction / deadline / POA). Left
        # as None on purpose: scripts/hedonic.py fills `price_estimate` from the
        # valuation model instead of inventing one here.
        "price": d.get("price"),
        "price_text": d.get("price_text"),
        "bedrooms": d.get("bedrooms"),
        "bathrooms": d.get("bathrooms"),
        "car_spaces": d.get("car_spaces"),
        "has_garage": bool(d.get("has_garage")),
        "land_area_m2": d.get("land_area_m2"),
        "floor_area_m2": d.get("floor_area_m2"),
        "property_type": d.get("property_type") or "house",
        "description": d.get("description"),
        "days_on_market": 0,  # by=latest, so these are the newest on market
        # Absolute URLs here; scripts/detail_harvest.py downloads and rewrites them.
        "images": [{"url": u, "position": i} for i, u in enumerate(d.get("images") or [])],
        "enrichment": {
            "land_area_m2": enr.get("land_area_m2") or d.get("land_area_m2"),
            "rateable_value": enr.get("rateable_value"),
            "estimate_value": enr.get("estimate_value"),
            "rental_estimate_weekly": enr.get("rental_estimate_weekly"),
        },
    }


def main() -> None:
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)

    print("=== HouseScout Multi-Runner Listing Builder ===\n")

    all_listings: list[dict] = []

    # Runner 0: live HTTP scrapers — the source of new listings.
    print("[Runner 0] Fetching current listings over HTTP...")
    live = run_api_scrapers()
    all_listings.extend(live)
    print(f"  -> {len(live)} live listings\n")

    # Runner 1: Load CI partial files
    print("[Runner 1] Loading CI partial files...")
    partials = load_partials()
    all_listings.extend(partials)
    print(f"  -> {len(partials)} from partials\n")

    # Merge & dedupe
    print("Merging & deduplicating...")
    final = dedupe_and_number(all_listings)

    OUT_JSON.write_text(json.dumps(final, indent=2) + "\n")
    if not final:
        # An empty file is the honest outcome of a failed scrape. The frontend renders
        # an empty state; it must never be backfilled with invented listings.
        print("\n! no listings collected — writing an empty file")
        print("  The site will show an empty state rather than placeholder data.")
        return
    print(f"\nWrote {len(final)} unique listings to {OUT_JSON.name}")
    print(f"  Sources: {', '.join(sorted(set(l.get('source','?') for l in final)))}")
    print(f"  Suburbs: {', '.join(sorted(set(l.get('suburb','?') for l in final if l.get('suburb'))))}")
    prices = [l["price"] for l in final if l.get("price")]
    if prices:
        print(f"  Price range: ${min(prices):,.0f} - ${max(prices):,.0f}")
        print(f"  Avg price: ${sum(prices)/len(prices):,.0f}")


if __name__ == "__main__":
    main()
