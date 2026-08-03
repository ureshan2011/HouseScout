#!/usr/bin/env python3
"""Check that every district in ``scraper/regions.py`` actually filters the search.

Why this exists
---------------
realestate.co.nz does not 404 an unrecognised location. A wrong region or district
slug returns **the nationwide default result page**, with HTTP 200 and a full grid of
tiles. So "the scrape returned 20 listings" proves nothing about whether it searched
the district you asked for.

That failure is invisible in every downstream artefact: the listings are real, the
photos are real, the model trains fine — and every row is tagged with a district it
did not come from. Selecting "Queenstown Lakes" in the UI would confidently show
listings from Oamaru and Balclutha.

Two slugs were caught by exactly this check and are why the catalogue looks the way it
does: the site uses ``manawatu-whanganui`` (not ``manawatu-wanganui``) and
``nelson-bays`` (not ``nelson``/``tasman``), and it groups Queenstown and Central Otago
under ``central-otago-lakes-district`` rather than ``otago``.

The test
--------
1. Fetch a deliberately bogus path to capture the nationwide fallback's listing ids.
2. A **region** is valid when its result set differs from that fallback.
3. A **district** is valid when it differs from the fallback *and* from its own
   region's result set — a district that returns its whole region is not filtering.

Listings churn, so the comparison is a Jaccard-style overlap with a threshold rather
than strict equality; a district genuinely narrowing its region overlaps it well under
80% on page 1 sorted by newest.

Usage::

    python scripts/verify_regions.py             # check the shipped catalogue
    python scripts/verify_regions.py --json      # machine-readable

Exits non-zero if any catalogued district fails, so it can gate a change to the
catalogue without being part of the (network-dependent) main build.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from scraper.api_scrapers import _fetch, parse_search_html  # noqa: E402
from scraper.regions import REGIONS  # noqa: E402

BASE = "https://www.realestate.co.nz/residential/sale"
# A path the site cannot resolve; whatever it returns is the fallback signature.
BOGUS = "not-a-real-region-xyz/not-a-real-district-xyz"
# Above this overlap, two paths are showing substantially the same page.
SAME = 0.8


def listing_ids(path: str) -> set[str] | None:
    html = _fetch(f"{BASE}/{path}?by=latest&page=1")
    if html is None:
        return None
    return {item["source_id"] for item in parse_search_html(html)}


def overlap(a: set[str], b: set[str]) -> float:
    """Share of `a` also present in `b`. 1.0 means a is contained in b."""
    return len(a & b) / len(a) if a else 0.0


def verify(paths: list[str], workers: int = 4) -> dict:
    """Fetch every path once (plus the fallback) and classify each district."""
    fallback = listing_ids(BOGUS) or set()
    time.sleep(0.5)

    unique = sorted({p for p in paths} | {p.split("/")[0] for p in paths})
    with ThreadPoolExecutor(max_workers=workers) as pool:
        fetched = dict(zip(unique, pool.map(listing_ids, unique)))

    results = {}
    for path in sorted(set(paths)):
        # A path with no district segment *is* its region, so the "does it narrow its
        # region" test does not apply — it would compare the page against itself and
        # report every whole-region row as broken.
        region_path = path.split("/")[0] if "/" in path else None
        got = fetched.get(path)
        region_got = fetched.get(region_path) if region_path else None
        if got is None:
            results[path] = {"ok": False, "reason": "fetch failed"}
        elif not got:
            results[path] = {"ok": False, "reason": "no tiles (slug not recognised)"}
        elif fallback and overlap(got, fallback) > SAME:
            results[path] = {"ok": False, "reason": "returns the nationwide fallback"}
        elif region_got and overlap(got, region_got) > SAME:
            results[path] = {"ok": False, "reason": f"returns all of /{region_path}"}
        else:
            results[path] = {
                "ok": True,
                "tiles": len(got),
                "region_overlap": round(overlap(got, region_got), 2) if region_got else None,
                "whole_region": region_path is None,
            }
    return results


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--json", action="store_true", help="emit JSON instead of a table")
    ap.add_argument("paths", nargs="*", help="extra location paths to probe")
    args = ap.parse_args()

    paths = [r.path for r in REGIONS.values()] + list(args.paths)
    results = verify(paths)

    if args.json:
        print(json.dumps(results, indent=2))
    else:
        by_path = {r.path: r.key for r in REGIONS.values()}
        print(f"{'location path':44s} {'status':>8s}  detail")
        for path, res in results.items():
            label = by_path.get(path, path)
            if res["ok"]:
                scope = (
                    "whole region"
                    if res["whole_region"]
                    else f"{res['region_overlap']:.0%} of region"
                )
                print(f"{path:44s} {'OK':>8s}  {res['tiles']} tiles, {scope}")
            else:
                print(f"{path:44s} {'FAIL':>8s}  {res['reason']}  ({label})")

    failed = [p for p, r in results.items() if not r["ok"]]
    if failed:
        print(f"\n{len(failed)} of {len(results)} location(s) do not filter as expected.")
        return 1
    print(f"\nAll {len(results)} locations filter correctly.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
