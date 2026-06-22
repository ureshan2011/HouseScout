#!/usr/bin/env python3
"""Keyless build-time scraper for one source -> a partial listings file (+ photos).

Designed to run as a parallel CI job per source (different runner IP + browser).
Set SCRAPE_SOURCE to scrape one site and write frontend/public/partials/<slug>.json;
leave it unset to scrape ALL configured sites locally and write listings.json directly.

Photos are downloaded and re-checked with Pillow so only real house pictures are kept
(landscape, large enough) — agent/human headshots and logos are dropped.

Defensive: any failure writes an empty result and exits 0 so the site build never
breaks (the app shows an empty state, never dummy data).

Env: SCRAPE_SOURCE, SCRAPE_BROWSER, SCRAPE_PRICE_MAX (500000), SCRAPE_MAX_PAGES (5).
"""
from __future__ import annotations

import io
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

PUBLIC_DIR = REPO_ROOT / "frontend" / "public"
PHOTO_DIR = PUBLIC_DIR / "photos"
PARTIAL_DIR = PUBLIC_DIR / "partials"

PRICE_MAX = int(os.environ.get("SCRAPE_PRICE_MAX", "500000"))
MAX_PAGES = int(os.environ.get("SCRAPE_MAX_PAGES", "5"))
SOURCE = os.environ.get("SCRAPE_SOURCE", "").strip()
BROWSER = os.environ.get("SCRAPE_BROWSER", "").strip() or None


def slugify(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def suburb_from_address(address: str | None) -> str | None:
    if not address:
        return None
    parts = [p.strip() for p in address.split(",") if p.strip()]
    return parts[-2] if len(parts) >= 2 else None


def _check_house_image(data: bytes) -> bool:
    """Second safety net: verify a downloaded image is a plausible house photo."""
    if len(data) < 3000:
        return False
    try:
        from PIL import Image  # type: ignore

        im = Image.open(io.BytesIO(data))
        w, h = im.size
        if w < 320 or h < 220:
            return False
        ratio = w / h if h else 0
        if 0.8 <= ratio <= 1.25 and max(w, h) < 520:  # square-ish small -> headshot/logo
            return False
        return True
    except Exception:  # noqa: BLE001 — Pillow missing or undecodable; keep on size alone
        return len(data) >= 8000


def download_photo(url: str, dest: Path, referer: str) -> bool:
    try:
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                "Referer": referer,
            },
        )
        with urllib.request.urlopen(req, timeout=30) as r:
            data = r.read()
        if not _check_house_image(data):
            return False
        dest.write_bytes(data)
        return True
    except Exception:  # noqa: BLE001
        return False


def map_listing(it, slug: str, seq: int, referer: str) -> dict:
    d = it.to_dict()
    images = []
    for j, src in enumerate(d.get("images") or []):
        if not src:
            continue
        rel = f"photos/{slug}-{seq}-{j}.jpg"
        if download_photo(src, PUBLIC_DIR / rel, referer):
            images.append({"url": rel, "position": len(images)})
    enr = d.get("enrichment") or {}
    return {
        "id": seq,  # placeholder; merge reassigns globally unique ids
        "source": d.get("source") or slug,
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


def scrape_source(name: str) -> list[dict]:
    from scraper.sites import SITES, scrape_site

    cfg = SITES.get(name)
    if not cfg:
        print(f"! unknown source '{name}'; known: {', '.join(SITES)}")
        return []
    slug = slugify(name)
    try:
        items = scrape_site(cfg, price_max=PRICE_MAX, max_pages=MAX_PAGES, browser_engine=BROWSER)
    except Exception as exc:  # noqa: BLE001
        print(f"! {name} scrape failed: {exc}")
        return []
    out = []
    for i, it in enumerate(items, start=1):
        if it.address:
            out.append(map_listing(it, slug, i, cfg.base))
    print(f"{name}: kept {len(out)} listings ({sum(len(o['images']) for o in out)} photos)")
    return out


def main() -> None:
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    PHOTO_DIR.mkdir(parents=True, exist_ok=True)

    if SOURCE:
        # Parallel CI mode: scrape one source -> partial file (+ namespaced photos).
        PARTIAL_DIR.mkdir(parents=True, exist_ok=True)
        listings = scrape_source(SOURCE)
        out = PARTIAL_DIR / f"{slugify(SOURCE)}.json"
        out.write_text(json.dumps(listings, indent=2) + "\n")
        print(f"Wrote {len(listings)} listings to {out}")
        return

    # Local mode: scrape everything sequentially and write the final file.
    sys.path.insert(0, str(REPO_ROOT / "scripts"))
    from scraper.sites import SITES
    from merge_listings import dedupe_and_number  # type: ignore

    all_listings: list[dict] = []
    for name in SITES:
        all_listings.extend(scrape_source(name))
    final = dedupe_and_number(all_listings)
    (PUBLIC_DIR / "listings.json").write_text(json.dumps(final, indent=2) + "\n")
    print(f"Wrote {len(final)} merged listings to listings.json")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001 — never fail the build
        PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
        target = PARTIAL_DIR / f"{slugify(SOURCE)}.json" if SOURCE else PUBLIC_DIR / "listings.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("[]\n")
        print(f"! unexpected error ({exc}); wrote empty {target.name}")
