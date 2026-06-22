#!/usr/bin/env python3
"""Merge per-source partial listing files into frontend/public/listings.json.

Run after the parallel scrape jobs have produced frontend/public/partials/*.json
(photos already sit in frontend/public/photos/). Dedupes across sources by
normalised address, sorts the richest records first, assigns globally unique
sequential ids, and writes the final listings.json the static app loads.

Always writes a valid file (possibly empty) so the build never breaks.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
PUBLIC_DIR = REPO_ROOT / "frontend" / "public"
PARTIAL_DIR = PUBLIC_DIR / "partials"
OUT_JSON = PUBLIC_DIR / "listings.json"


def norm_address(a: str | None) -> str:
    if not a:
        return ""
    a = a.lower()
    a = re.sub(r"\b(street|st|road|rd|avenue|ave|drive|dr|lane|ln|place|pl|crescent|cres|"
               r"terrace|tce|court|ct|christchurch|canterbury|new zealand|nz)\b", "", a)
    return re.sub(r"[^a-z0-9]", "", a)


def richness(l: dict) -> int:
    """More complete records win when deduping (photos matter most)."""
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
    # Prefer richer + cheaper listings near the top of the default view.
    merged.sort(key=lambda l: (-richness(l), l.get("price") or 9_999_999))
    for i, l in enumerate(merged, start=1):
        l["id"] = i
    return merged


def main() -> None:
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    listings: list[dict] = []
    if PARTIAL_DIR.exists():
        for f in sorted(PARTIAL_DIR.glob("*.json")):
            try:
                data = json.loads(f.read_text())
                if isinstance(data, list):
                    listings.extend(data)
                    print(f"  + {f.name}: {len(data)} listings")
            except Exception as exc:  # noqa: BLE001
                print(f"  ! skipping {f.name}: {exc}")
    final = dedupe_and_number(listings)
    OUT_JSON.write_text(json.dumps(final, indent=2) + "\n")
    print(f"Merged {len(listings)} -> {len(final)} unique listings in {OUT_JSON.name}")


if __name__ == "__main__":
    main()
