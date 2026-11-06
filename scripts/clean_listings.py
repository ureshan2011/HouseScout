#!/usr/bin/env python3
"""Clean and enrich the merged listings before the valuation model trains on them.

Runs after ``detail_harvest.py`` and before ``hedonic.py``. Every change is recorded in
the listing's ``data_fixes`` list so the UI (and anyone auditing a valuation) can see
what was corrected and why. Nothing is invented: a field is only filled when the
listing's own text states it.

What it fixes, each found in the live Nov 2026 scrape:

* **Hectares stored as square metres.** Search tiles show "4 ha"; the scrapers keep the
  leading number, so a 4-hectare block arrived as 4 m². No freehold house sits on under
  50 m², so a figure that small is read as hectares.
* **Bare sections listed as houses.** Subdivision lots ("Priced from $235,000 for
  600sqm") come through typed as houses with no bedrooms. Left alone they sit on the
  house shortlist and teach the model that some suburbs are 30% cheaper than they are.
* **Lifestyle blocks listed as houses.** A house on a hectare or more is a different
  market from a suburban section.
* **Attributes only in the description.** Bedrooms, bathrooms, floor and land area are
  filled from phrases like "3 bedroom", "180m² home", "650sqm section" when the
  structured field is empty.
* **New builds.** Flagged from build language ("brand new", "titles issued", "10 year
  builder warranty") — used by the townhouse shortlist and shown on the listing.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
LISTINGS_JSON = REPO_ROOT / "frontend" / "public" / "listings.json"

HECTARE = 10_000.0
# Smallest plausible freehold title. Anything under this, on a non-apartment, is hectares.
MIN_PLAUSIBLE_LAND_M2 = 50.0
LIFESTYLE_MIN_M2 = 10_000.0

_NUM = r"(\d[\d,]*(?:\.\d+)?)"
_AREA = r"\s*(?:m²|m2|sqm|sq\.?\s?m|square\s+met(?:re|er)s?)"

SECTION_TEXT = re.compile(
    r"\b(sections?|bare\s+land|land\s+only|vacant\s+(?:land|site)|build\s+your|"
    r"subdivision|titles?\s+(?:are\s+|now\s+)?(?:issued|due)|lots?\s+\d+|stage\s+\d+|"
    r"house\s*(?:and|&)\s*land|ready\s+to\s+build|building\s+site)\b",
    re.I,
)
LIFESTYLE_TEXT = re.compile(r"\b(lifestyle|hectares?|\d+(?:\.\d+)?\s*ha\b|acres?|paddocks?|grazing)\b", re.I)

BEDROOMS = re.compile(r"\b(\d{1,2})[\s-]*(?:double\s+)?(?:bed(?:room)?s?|brm)\b", re.I)
BATHROOMS = re.compile(r"\b(\d)[\s-]*(?:bath(?:room)?s?)\b", re.I)
FLOOR = re.compile(_NUM + _AREA + r"\s+(?:of\s+)?(?:home|house|floor|living|dwelling|townhouse|build)", re.I)
FLOOR_LEAD = re.compile(r"floor\s*(?:area|plan)?\s*(?:of|:)?\s*" + _NUM + _AREA, re.I)
LAND = re.compile(_NUM + _AREA + r"\s+(?:section|site|land|lot|block|property)", re.I)
LAND_HA = re.compile(_NUM + r"\s*(?:ha|hectares?)\b", re.I)

# Kept in step with NEW_BUILD in frontend/lib/townhouse.ts.
NEW_BUILD = [
    re.compile(p, re.I)
    for p in (
        r"\bnew\s*-?\s*build",
        r"\bnewly\s+(built|constructed|completed)",
        # "brand-new" alone also describes kitchens and carpets; require a dwelling.
        r"\bbrand[\s-]*new\s+(?:[\w-]+,?\s+){0,2}(home|house|townhouse|dwelling|build|property)",
        r"\bnew\s+(townhouses?|developments?|subdivision|release|stage\s+\d)",
        r"\bquality\s+new\s+homes?\b",
        r"\bbuilt\s+(in\s+)?(20(2[4-9]|3\d))\b",
        r"\b(completed|completion)\s+(in\s+)?(20(2[4-9]|3\d)|early|mid|late|q[1-4])",
        r"\b(off[\s-]*the[\s-]*plans?|to\s+be\s+built|under\s+construction)\b",
        r"\b10[\s-]*year\s+(build|builder)\s*(warranty|guarantee)\b",
        r"\bnever\s+(been\s+)?(lived|occupied)\b",
    )
]


def _num(s: str) -> float:
    return float(s.replace(",", ""))


def _text(listing: dict) -> str:
    return " ".join(str(listing.get(k) or "") for k in ("title", "description", "price_text"))


def _ptype(listing: dict) -> str:
    return (listing.get("property_type") or "house").lower()


def _fix(listing: dict, note: str) -> None:
    listing.setdefault("data_fixes", [])
    if note not in listing["data_fixes"]:
        listing["data_fixes"].append(note)


def fix_land_units(listing: dict) -> None:
    if _ptype(listing) in ("apartment", "unit"):
        return
    for holder in (listing, listing.get("enrichment") or {}):
        land = holder.get("land_area_m2")
        if isinstance(land, (int, float)) and 0 < land < MIN_PLAUSIBLE_LAND_M2:
            holder["land_area_m2"] = round(land * HECTARE)
            _fix(listing, f"land area read as {land:g} ha, not {land:g} m²")


def fill_from_text(listing: dict) -> None:
    text = _text(listing)
    if not text.strip():
        return
    if not listing.get("bedrooms") and (m := BEDROOMS.search(text)) and 1 <= int(m.group(1)) <= 8:
        listing["bedrooms"] = int(m.group(1))
        _fix(listing, "bedrooms taken from the description")
    if not listing.get("bathrooms") and (m := BATHROOMS.search(text)) and 1 <= int(m.group(1)) <= 5:
        listing["bathrooms"] = int(m.group(1))
        _fix(listing, "bathrooms taken from the description")
    if not listing.get("floor_area_m2"):
        m = FLOOR.search(text) or FLOOR_LEAD.search(text)
        if m and 30 <= _num(m.group(1)) <= 800:
            listing["floor_area_m2"] = _num(m.group(1))
            _fix(listing, "floor area taken from the description")
    enr = listing.get("enrichment") or {}
    if not (listing.get("land_area_m2") or enr.get("land_area_m2")):
        land = None
        if (m := LAND.search(text)) and 80 <= _num(m.group(1)) <= 200_000:
            land = _num(m.group(1))
        elif (m := LAND_HA.search(text)) and 0.1 <= _num(m.group(1)) <= 500:
            land = round(_num(m.group(1)) * HECTARE)
        if land:
            listing["land_area_m2"] = land
            _fix(listing, "land area taken from the description")


def land_of(listing: dict) -> float | None:
    return (listing.get("enrichment") or {}).get("land_area_m2") or listing.get("land_area_m2")


def reclassify(listing: dict) -> None:
    if _ptype(listing) != "house":
        return
    text = _text(listing)
    land = land_of(listing) or 0
    if not listing.get("bedrooms") and SECTION_TEXT.search(text):
        # A large bare block is still land, not a lifestyle home.
        listing["property_type"] = "section"
        _fix(listing, "re-typed house → section: no bedrooms and the text describes land")
    elif land >= LIFESTYLE_MIN_M2 and (listing.get("bedrooms") or LIFESTYLE_TEXT.search(text)):
        listing["property_type"] = "lifestyle"
        _fix(listing, f"re-typed house → lifestyle: {land / HECTARE:.1f} ha of land")


def looks_new_build(listing: dict) -> bool:
    text = f"{listing.get('title') or ''} {listing.get('description') or ''}"
    return any(p.search(text) for p in NEW_BUILD)


def clean(listing: dict) -> dict:
    fix_land_units(listing)
    fill_from_text(listing)
    reclassify(listing)
    listing["new_build"] = looks_new_build(listing)
    return listing


def main() -> None:
    if not LISTINGS_JSON.exists():
        print("No listings.json; nothing to clean.")
        return
    listings = json.loads(LISTINGS_JSON.read_text())
    if not isinstance(listings, list):
        return
    for l in listings:
        clean(l)
    LISTINGS_JSON.write_text(json.dumps(listings, indent=2) + "\n")

    fixes: dict[str, int] = {}
    for l in listings:
        for f in l.get("data_fixes", []):
            key = re.sub(r"[\d.]+ ha, not [\d.]+ m²", "N ha, not N m²", f)
            key = re.sub(r"[\d.]+ ha of land", "N ha of land", key)
            fixes[key] = fixes.get(key, 0) + 1
    print("=== Listing clean-up ===")
    for k, n in sorted(fixes.items(), key=lambda x: -x[1]):
        print(f"  {n:4d}  {k}")
    print(f"  {sum(1 for l in listings if l.get('new_build'))} flagged as new builds")


if __name__ == "__main__":
    main()
