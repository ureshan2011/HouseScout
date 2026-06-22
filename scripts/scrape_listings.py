#!/usr/bin/env python3
"""Keyless build-time scraper -> frontend/public/listings.json (+ photos).

Runs the repo's realestate.co.nz Playwright scraper, maps results into the static
app's listing shape, downloads each photo so it's self-hosted, and writes a JSON
file the GitHub Pages site loads at runtime. No API keys required.

Defensive by design: if Playwright/network/the site fails (e.g. the CI runner is
blocked) it writes an empty list and exits 0 so the site build still succeeds — the
app shows an empty state, never dummy data.

Usage (from repo root):
    python scripts/scrape_listings.py
Env: SCRAPE_PRICE_MAX (500000), SCRAPE_MAX_PAGES (3).
"""
from __future__ import annotations

import json
import os
import shutil
import sys
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

PUBLIC_DIR = REPO_ROOT / "frontend" / "public"
PHOTO_DIR = PUBLIC_DIR / "photos"
OUT_JSON = PUBLIC_DIR / "listings.json"

PRICE_MAX = int(os.environ.get("SCRAPE_PRICE_MAX", "500000"))
MAX_PAGES = int(os.environ.get("SCRAPE_MAX_PAGES", "3"))


def suburb_from_address(address: str | None) -> str | None:
    """Best-effort suburb from a comma-separated address ('12 X St, Aranui, Christchurch')."""
    if not address:
        return None
    parts = [p.strip() for p in address.split(",") if p.strip()]
    return parts[-2] if len(parts) >= 2 else None


def download_photo(url: str, dest: Path) -> bool:
    try:
        req = urllib.request.Request(
            url, headers={"User-Agent": "HouseScout/0.1 (personal use)", "Referer": "https://www.realestate.co.nz/"}
        )
        with urllib.request.urlopen(req, timeout=30) as r:
            data = r.read()
        if len(data) < 1000:  # skip tiny/placeholder responses
            return False
        dest.write_bytes(data)
        return True
    except Exception:
        return False


def write_empty(reason: str) -> None:
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text("[]\n")
    print(f"! {reason} — wrote empty listings.json")


def main() -> None:
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)

    try:
        from scraper.realestate import scrape
    except Exception as exc:  # noqa: BLE001
        write_empty(f"scraper import failed ({exc})")
        return

    items = []
    try:
        items = scrape(price_max=PRICE_MAX, max_pages=MAX_PAGES)
    except Exception as exc:  # noqa: BLE001
        print(f"! scrape error: {exc}")
    print(f"Scraped {len(items)} listings from realestate.co.nz (<= ${PRICE_MAX:,})")

    # Fresh photo dir each run so removed listings don't leave orphans.
    shutil.rmtree(PHOTO_DIR, ignore_errors=True)
    PHOTO_DIR.mkdir(parents=True, exist_ok=True)

    out = []
    for i, it in enumerate(items, start=1):
        d = it.to_dict()
        images = []
        for j, src in enumerate(d.get("images") or []):
            if not src:
                continue
            rel = f"photos/{i}-{j}.jpg"
            if download_photo(src, PUBLIC_DIR / rel):
                images.append({"url": rel, "position": j})
        enr = d.get("enrichment") or {}
        out.append(
            {
                "id": i,  # stable sequential id for static routes
                "source": d.get("source") or "realestate.co.nz",
                "source_id": d.get("source_id"),
                "url": d.get("url"),
                "address": d.get("address"),
                "suburb": d.get("suburb") or suburb_from_address(d.get("address")),
                "lat": d.get("lat"),
                "lng": d.get("lng"),
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
                "days_on_market": None,
                "images": images,
                "enrichment": {
                    "land_area_m2": enr.get("land_area_m2") or d.get("land_area_m2"),
                    "rateable_value": enr.get("rateable_value"),
                    "estimate_value": enr.get("estimate_value"),
                    "rental_estimate_weekly": enr.get("rental_estimate_weekly"),
                },
            }
        )

    OUT_JSON.write_text(json.dumps(out, indent=2) + "\n")
    print(f"Wrote {len(out)} listings to {OUT_JSON}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001 — never fail the build
        write_empty(f"unexpected error ({exc})")
