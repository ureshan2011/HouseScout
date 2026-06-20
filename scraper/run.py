"""Scraper orchestration + CLI.

Usage (from repo root, with backend deps installed):
    python -m scraper.run --dry-run          # collect & print, don't save
    python -m scraper.run                     # collect, enrich, save to DB
    python -m scraper.run --source realestate.co.nz --max-pages 2

Adds the repo root to sys.path so both `scraper` and `app` import cleanly.
"""
from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "backend"))

from scraper import homes, oneroof, realestate  # noqa: E402
from scraper.base import NormalisedListing, Throttle  # noqa: E402
from scraper.linz import LinzClient  # noqa: E402

log = logging.getLogger(__name__)

SCRAPERS = {realestate.SOURCE: realestate.scrape}


def collect(source: str | None = None, price_max: int | None = None,
            max_pages: int = 3, enrich: bool = True, estimates: bool = False) -> list[dict]:
    """Run scrapers and enrich each listing.

    Enrichment layers:
      * LINZ (free): land area -> backyard filter. Auto when a LINZ key is set.
      * homes.co.nz / OneRoof (estimates, RV, rental estimate): only when
        `estimates=True` (heavier — one browser navigation per listing).
    """
    from app.config import settings  # imported here so CLI works without env at import time

    price_max = price_max or int(settings.max_price)
    items: list[NormalisedListing] = []
    targets = {source: SCRAPERS[source]} if source else SCRAPERS
    for name, fn in targets.items():
        log.info("Scraping %s ...", name)
        items.extend(fn(price_max=price_max, max_pages=max_pages))

    linz = LinzClient(settings.linz_api_key) if (enrich and settings.linz_api_key) else None
    throttle = Throttle(3.0)
    for it in items:
        if not it.address:
            continue
        if linz and it.land_area_m2 is None:
            data = linz.land_area_for_address(it.address)
            if data:
                it.land_area_m2 = data.get("land_area_m2") or it.land_area_m2
                it.enrichment = {**(it.enrichment or {}), **data}
        if estimates:
            # homes.co.nz first, fall back to OneRoof for any missing fields.
            est = homes.enrich(it.address, throttle) or {}
            for provider in (oneroof.enrich,):
                missing = not all(est.get(k) for k in ("estimate_value", "rateable_value"))
                if missing:
                    extra = provider(it.address, throttle) or {}
                    est = {**extra, **est}  # keep homes values where present
            if est:
                it.enrichment = {**(it.enrichment or {}), **est}

    return [it.to_dict() for it in items]


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    ap = argparse.ArgumentParser(description="HouseScout scraper")
    ap.add_argument("--source", choices=list(SCRAPERS), default=None)
    ap.add_argument("--max-pages", type=int, default=3)
    ap.add_argument("--price-max", type=int, default=None)
    ap.add_argument("--estimates", action="store_true",
                    help="enrich with homes.co.nz/OneRoof estimates (slower)")
    ap.add_argument("--rates-only", action="store_true",
                    help="only refresh mortgage rates from interest.co.nz")
    ap.add_argument("--dry-run", action="store_true", help="print results, don't save")
    args = ap.parse_args()

    if args.rates_only:
        from app.scraper_hook import refresh_rates
        print(refresh_rates())
        return

    items = collect(source=args.source, price_max=args.price_max,
                    max_pages=args.max_pages, estimates=args.estimates)
    print(f"Collected {len(items)} listings.")
    if args.dry_run:
        for it in items[:10]:
            print(f"  - {it.get('address')} | {it.get('price_text')} | "
                  f"{it.get('bedrooms')}bd garage={it.get('has_garage')}")
        return

    # Save directly (collect already ran) to avoid re-scraping.
    from app.db import SessionLocal
    from app.scoring_service import rescore_all
    from app.scraper_hook import upsert_listing

    db = SessionLocal()
    try:
        for it in items:
            upsert_listing(db, it)
        db.commit()
        n = rescore_all(db)
        print(f"Saved {len(items)} listings; rescored {n}.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
