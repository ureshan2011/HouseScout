#!/usr/bin/env python3
"""Annotate every listing with where each of its numbers actually came from.

Why this is not optional
------------------------
The listing corpus mixes three very different kinds of number:

  1. **Observed** — published by the source listing (an "Asking Price $430,000",
     the bedroom count, the address, the land area).
  2. **Not published** — the source states no price. Most Christchurch stock sells by
     Deadline Sale, Auction or "by negotiation", so ``price`` is simply null. The
     valuation model supplies ``price_estimate`` instead (scripts/hedonic.py), which
     is cross-validated and carries a confidence band — unlike the suburb-band guess
     the deleted ``expand_listings.py`` used to write straight into ``price``.
Hand-written demonstration records used to be a third category. They are gone: the
build now ships only scraped listings, and an empty scrape produces an empty site
rather than invented content.

Presenting a modelled price with a dollar sign next to a real address, and running
mortgage projections off it, reads as a factual asking price. That is fine for a
personal tool and not fine for a product with paying subscribers — in New Zealand it
engages the Fair Trading Act's misleading-representation provisions, and it would
destroy user trust the first time someone rang an agent quoting our number.

This step attaches machine-readable provenance so the UI can label each figure
truthfully, the valuation model can train only on observed prices, and modelled
figures can be presented as *our estimate* rather than *the price*.

Adds to each listing::

    "provenance": { "price": "observed"|"not_published", "land_area_m2": ..., ... }
    "estimated_fields": ["price", "rateable_value", ...]
    "data_quality": "observed" | "estimated"

Run after build_listings.py / merge_listings.py, and after hedonic.py has written
``price_estimate``.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
PUBLIC_DIR = REPO_ROOT / "frontend" / "public"
LISTINGS_JSON = PUBLIC_DIR / "listings.json"

PRICE_IN_TEXT = re.compile(r"\$\s*[\d,]{6,}")


def annotate(listing: dict) -> dict:
    """Attach provenance to one listing (in place) and return it."""
    price_observed = bool(PRICE_IN_TEXT.search(listing.get("price_text") or ""))
    enr = listing.get("enrichment") or {}

    prov = {
        # A price is only observed when the listing text actually quotes a figure.
        "price": "observed" if price_observed else "not_published",
        "address": "observed",
        "bedrooms": "observed" if listing.get("bedrooms") else "unknown",
        "bathrooms": "observed" if listing.get("bathrooms") else "unknown",
        "land_area_m2": "observed" if listing.get("land_area_m2") else "unknown",
        "floor_area_m2": "observed" if listing.get("floor_area_m2") else "unknown",
        # Coordinates are a suburb centroid plus a deterministic offset, never a
        # true geocode — the map pin is indicative of the suburb, not the section.
        "coordinates": "suburb_centroid",
        # RV / estimate / rental are fixed multiples of `price`, so they inherit
        # its provenance at best and are modelled at worst.
        "rateable_value": "modelled" if enr.get("rateable_value") else "unknown",
        "estimate_value": "modelled" if enr.get("estimate_value") else "unknown",
        "rental_estimate_weekly": "modelled" if enr.get("rental_estimate_weekly") else "unknown",
        # Present when the valuation model filled the gap (scripts/hedonic.py).
        "price_estimate": "modelled" if listing.get("price_estimate") else "unknown",
        "photos": "source" if listing.get("images") else "none",
        "record": "scraped",
    }

    estimated = sorted(k for k, v in prov.items() if v == "modelled")
    quality = "observed" if price_observed else "estimated"

    listing["provenance"] = prov
    listing["estimated_fields"] = estimated
    listing["data_quality"] = quality
    return listing


def main() -> None:
    if not LISTINGS_JSON.exists():
        print("! no listings.json; nothing to annotate")
        return
    try:
        listings = json.loads(LISTINGS_JSON.read_text())
    except json.JSONDecodeError as exc:
        print(f"! listings.json unreadable ({exc}); skipping annotation")
        return
    if not isinstance(listings, list):
        print("! listings.json is not a list; skipping annotation")
        return

    for listing in listings:
        annotate(listing)

    LISTINGS_JSON.write_text(json.dumps(listings, indent=2) + "\n")

    counts: dict[str, int] = {}
    for l in listings:
        counts[l["data_quality"]] = counts.get(l["data_quality"], 0) + 1
    photos = sum(1 for l in listings if l.get("images"))

    print("=== Data provenance ===")
    print(f"  {len(listings)} listings annotated")
    for key in ("observed", "estimated"):
        if counts.get(key):
            print(f"    {key:<9}: {counts[key]}")
    print(f"  with photos: {photos}/{len(listings)}")
    if counts.get("estimated"):
        print(
            f"  note: {counts['estimated']} listings publish no price (auction/deadline);"
            " the valuation model supplies price_estimate for those"
        )


if __name__ == "__main__":
    main()
