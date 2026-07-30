#!/usr/bin/env python3
"""Detail-page harvest: photos **and** the attributes search pages don't carry.

Detail pages are reachable over plain HTTP even though search pages are behind bot
protection, so one fetch per listing yields far more than the search tile does. Both
things this module extracts were blocking bugs:

**Photos.** Cards rendered as blank grey boxes because almost no listing carried a
usable photo — the hand-written seed data wrote ``images: []``, and the only code
that downloaded any was the Playwright path, which is routinely blocked in CI. Here
we pull the mediaserver URLs out of the markup, pick the largest variant of each
distinct photo, verify each decodes as a plausible house picture, and self-host it
under ``public/photos/``. Self-hosting matters beyond reliability: hotlinked
mediaserver URLs rotate and expire, which would silently blank the grid again.

**Attributes.** Search tiles carry no parking information at all, and their
"description" field is just the address repeated — so garage detection saw nothing
and *every* listing came back ``has_garage: False``. Since a garage is one of the
buyer's hard filters, the entire result set was empty. Detail pages state garage and
carport counts explicitly, alongside floor area and the real listing description.

Both are harvested from the same fetch, so enriching costs no extra requests.

Every failure path is non-fatal: a listing that yields no photo keeps ``images: []``
and the frontend draws generated artwork (``frontend/components/PropertyImage.tsx``);
a listing that yields no attributes keeps whatever the search page gave us.
"""
from __future__ import annotations

import io
import json
import re
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
PUBLIC_DIR = REPO_ROOT / "frontend" / "public"
PHOTO_DIR = PUBLIC_DIR / "photos"
LISTINGS_JSON = PUBLIC_DIR / "listings.json"

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

MAX_PER_LISTING = 6
WORKERS = 6
FETCH_TIMEOUT = 25

# Matches every realestate.co.nz mediaserver variant, e.g.
#   .../listings/43070799/1ef4977a….crop.576x384.jpg
#   .../listings/43069226/d8b9e8db….pad-ffffff.990x661.jpg
MEDIA_RE = re.compile(
    r"https://mediaserver\.realestate\.co\.nz/listings/(\d+)/([0-9a-f]{8,})\.([a-z0-9-]+)\.(\d+)x(\d+)\.jpg",
    re.I,
)

# URL fragments that never denote a house photo (agent headshots, office branding).
BAD_URL_HINTS = ("agent", "profile", "headshot", "logo", "avatar", "office", "brand", "vendor")


# --------------------------------------------------------------------------- #
# Image verification
# --------------------------------------------------------------------------- #
def check_house_image(data: bytes) -> bool:
    """Return True if ``data`` decodes as a plausible house photo.

    Drops tiny files, thumbnails and square-ish small images (the shape of agent
    headshots and logos). Falls back to a size heuristic when Pillow is absent so
    the pipeline still works in a bare environment.
    """
    if len(data) < 3000:
        return False
    try:
        from PIL import Image  # type: ignore

        im = Image.open(io.BytesIO(data))
        w, h = im.size
        if w < 320 or h < 220:
            return False
        ratio = w / h if h else 0
        if 0.8 <= ratio <= 1.25 and max(w, h) < 520:  # square-ish + small -> headshot/logo
            return False
        return True
    except Exception:  # noqa: BLE001 — Pillow missing or undecodable; judge on size alone
        return len(data) >= 8000


def _fetch_bytes(url: str, referer: str = "https://www.realestate.co.nz/") -> bytes | None:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Referer": referer})
        with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT) as r:
            return r.read()
    except Exception:  # noqa: BLE001
        return None


def _fetch_text(url: str) -> str | None:
    try:
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": UA,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-NZ,en;q=0.9",
            },
        )
        with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT) as r:
            return r.read().decode("utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        return None


# --------------------------------------------------------------------------- #
# Candidate discovery
# --------------------------------------------------------------------------- #
def largest_variants(html: str, limit: int = MAX_PER_LISTING) -> list[str]:
    """Extract distinct gallery photos from a listing page, largest variant each.

    A single photo appears many times in the markup at different sizes (100x57 up
    to 990x661). Photos are keyed by their content hash so each real picture is
    downloaded once, at the biggest size offered, in first-appearance order.
    """
    best: dict[str, tuple[int, str]] = {}
    order: list[str] = []
    for m in MEDIA_RE.finditer(html):
        url = m.group(0)
        if any(h in url.lower() for h in BAD_URL_HINTS):
            continue
        photo_hash = m.group(2)
        area = int(m.group(4)) * int(m.group(5))
        if photo_hash not in best:
            order.append(photo_hash)
        if photo_hash not in best or area > best[photo_hash][0]:
            best[photo_hash] = (area, url)
    # Ignore variants too small to be worth self-hosting (thumbnail-only photos).
    return [best[h][1] for h in order if best[h][0] >= 320 * 220][:limit]


def candidate_urls(listing: dict) -> list[str]:
    """Absolute photo URLs already attached to a listing, best-effort ordered."""
    out: list[str] = []
    for im in listing.get("images") or []:
        url = (im or {}).get("url") if isinstance(im, dict) else im
        if isinstance(url, str) and url.startswith("http") and not any(
            h in url.lower() for h in BAD_URL_HINTS
        ):
            out.append(url)
    return out


def detail_page_url(listing: dict) -> str | None:
    """The realestate.co.nz detail page for a listing, if it has a real id."""
    sid = str(listing.get("source_id") or "")
    if not re.fullmatch(r"\d{6,}", sid):
        return None
    if "realestate.co.nz" not in (listing.get("source") or ""):
        return None
    return f"https://www.realestate.co.nz/{sid}"


# --------------------------------------------------------------------------- #
# Attribute extraction
#
# Each feature on a detail page is an <svg> whose <title> names it, followed by a
# span holding the value:
#     <svg …><title id="…">Garage</title>…</svg><span class="leading-[-1]">1</span>
# Keying on the <title> text is stable — it is the icon's accessible name, so it
# cannot be renamed without breaking screen readers.
# --------------------------------------------------------------------------- #
TITLE_RE = re.compile(r"<title[^>]*>([^<]{1,40})</title>", re.S)
VALUE_RE = re.compile(r'<span class="leading-\[-1\]">(.{0,120}?)</span>', re.S)
TAG_RE = re.compile(r"<[^>]+>")
DESCRIPTION_RE = re.compile(
    r'data-test="description-content__description"[^>]*>(.{0,6000}?)</div>', re.S
)

# Only these labels are meaningful; the page also has nav and share icons with titles.
WANTED_FEATURES = {
    "Bedroom", "Bedrooms", "Bathroom", "Bathrooms", "Garage", "Garages",
    "Carport", "Carports", "Off street parking", "Floor area", "Land area",
}


def _plain(fragment: str) -> str:
    return re.sub(r"\s+", " ", TAG_RE.sub("", fragment)).strip()


def extract_features(html: str) -> dict[str, str]:
    """Map feature label -> raw value string, e.g. {"Garage": "1", "Land area": "620m2"}."""
    out: dict[str, str] = {}
    for m in TITLE_RE.finditer(html):
        label = m.group(1).strip()
        if label not in WANTED_FEATURES or label in out:
            continue
        value = VALUE_RE.search(html, m.end())
        if value:
            out[label] = _plain(value.group(1))
    return out


def extract_description(html: str) -> str | None:
    """The listing's real prose description, not the address the search tile repeats."""
    m = DESCRIPTION_RE.search(html)
    if not m:
        return None
    text = _plain(m.group(1))
    return text or None


def _first_int(text: str | None) -> int | None:
    if not text:
        return None
    m = re.match(r"\s*(\d+)", text)
    return int(m.group(1)) if m else None


def apply_detail_fields(listing: dict, html: str) -> list[str]:
    """Fill attributes the search page couldn't supply. Returns the fields updated.

    Only fills gaps and corrects the two fields search pages get wrong (parking,
    description) — anything the search page stated correctly is left alone.
    """
    updated: list[str] = []
    features = extract_features(html)

    garages = _first_int(features.get("Garage") or features.get("Garages"))
    carports = _first_int(features.get("Carport") or features.get("Carports"))
    off_street = _first_int(features.get("Off street parking"))
    spaces = sum(v for v in (garages, carports, off_street) if v)

    if spaces:
        listing["car_spaces"] = spaces
        updated.append("car_spaces")
    # A garage proper — a carport or an open pad is not one, and the buyer's hard
    # filter is specifically for a garage.
    if garages:
        listing["has_garage"] = True
        updated.append("has_garage")

    description = extract_description(html)
    if description:
        listing["description"] = description
        updated.append("description")
        # Some listings name a garage only in prose ("internal access garaging").
        if not listing.get("has_garage") and re.search(
            r"\bgarag|\binternal access\b", description, re.I
        ):
            listing["has_garage"] = True
            updated.append("has_garage")

    for label, key in (("Floor area", "floor_area_m2"), ("Land area", "land_area_m2")):
        value = _first_int(features.get(label))
        if value and not listing.get(key):
            listing[key] = float(value)
            updated.append(key)
            if key == "land_area_m2":
                listing.setdefault("enrichment", {})["land_area_m2"] = float(value)

    for label, key in (("Bedroom", "bedrooms"), ("Bathroom", "bathrooms")):
        value = _first_int(features.get(label) or features.get(label + "s"))
        if value and not listing.get(key):
            listing[key] = value
            updated.append(key)

    return updated


# --------------------------------------------------------------------------- #
# Harvest
# --------------------------------------------------------------------------- #
def harvest_one(listing: dict, max_photos: int = MAX_PER_LISTING) -> list[dict]:
    """Harvest one listing's detail page: photos returned, attributes applied in place.

    Tries photo URLs already on the listing first, then the detail-page gallery. The
    same fetched HTML also fills in parking, description and areas. Returns ``[]``
    when no usable photo could be fetched.
    """
    lid = listing.get("id")
    urls = candidate_urls(listing)

    page = detail_page_url(listing)
    if page:
        html = _fetch_text(page)
        if html:
            apply_detail_fields(listing, html)
            for url in largest_variants(html, max_photos):
                if url not in urls:
                    urls.append(url)

    images: list[dict] = []
    for url in urls[: max_photos * 2]:  # allow for rejects
        if len(images) >= max_photos:
            break
        data = _fetch_bytes(url, referer=page or "https://www.realestate.co.nz/")
        if not data or not check_house_image(data):
            continue
        rel = f"photos/{lid}-{len(images)}.jpg"
        dest = PUBLIC_DIR / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        try:
            dest.write_bytes(data)
        except OSError:
            continue
        images.append({"url": rel, "position": len(images)})
    return images


def harvest(listings: list[dict], max_photos: int = MAX_PER_LISTING, workers: int = WORKERS) -> dict:
    """Populate ``images`` for every listing in place. Returns summary stats."""
    PHOTO_DIR.mkdir(parents=True, exist_ok=True)

    def work(listing: dict) -> tuple[dict, list[dict]]:
        try:
            return listing, harvest_one(listing, max_photos)
        except Exception:  # noqa: BLE001 — one bad listing must not stop the build
            return listing, []

    with ThreadPoolExecutor(max_workers=workers) as pool:
        for listing, images in pool.map(work, listings):
            # Only overwrite when we actually got something; never lose existing photos.
            if images:
                listing["images"] = images
            elif not isinstance(listing.get("images"), list):
                listing["images"] = []
            else:
                # Drop unverified remote hotlinks — they blank the grid when they rotate.
                listing["images"] = [
                    im for im in listing["images"]
                    if isinstance(im, dict) and not str(im.get("url", "")).startswith("http")
                ]

    with_photos = sum(1 for l in listings if l.get("images"))
    total = sum(len(l.get("images") or []) for l in listings)
    return {
        "listings": len(listings),
        "with_photos": with_photos,
        "photos": total,
        "coverage_pct": round(100 * with_photos / len(listings), 1) if listings else 0.0,
        "with_garage": sum(1 for l in listings if l.get("has_garage")),
        "with_description": sum(
            1 for l in listings if (l.get("description") or "") and
            l.get("description") != l.get("address")
        ),
    }


def main() -> None:
    if not LISTINGS_JSON.exists():
        print("! no listings.json; nothing to do")
        return
    listings = json.loads(LISTINGS_JSON.read_text())
    if not isinstance(listings, list) or not listings:
        print("! listings.json empty; nothing to do")
        return

    limit = None
    for i, arg in enumerate(sys.argv[1:]):
        if arg == "--limit" and i + 2 <= len(sys.argv[1:]):
            limit = int(sys.argv[i + 2])
    target = listings[:limit] if limit else listings

    print(f"=== Detail-page harvest ({len(target)} listings) ===")
    stats = harvest(target)
    LISTINGS_JSON.write_text(json.dumps(listings, indent=2) + "\n")
    print(
        f"  photos      : {stats['photos']} across {stats['with_photos']}/{stats['listings']} "
        f"listings ({stats['coverage_pct']}% coverage)"
    )
    print(f"  with garage : {stats['with_garage']}/{stats['listings']}")
    print(f"  descriptions: {stats['with_description']}/{stats['listings']}")
    if stats["coverage_pct"] < 50:
        print("  note: low coverage — remaining listings render generated artwork")
    if not stats["with_garage"]:
        print("  ! no garages detected — the garage hard filter will exclude everything")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001 — never fail the site build over this
        print(f"! detail harvest failed ({exc}); listings keep what the search page gave")
