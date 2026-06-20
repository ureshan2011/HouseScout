"""Bridge between the API/scheduler and the standalone `scraper` package.

Keeps the heavy scraping deps (Playwright) out of the request path until actually
needed, and upserts normalised listings into the DB + rescoring.
"""
from __future__ import annotations

import logging

from .db import SessionLocal
from .models import Listing, ListingImage, PricePoint, PropertyEnrichment
from .scoring_service import rescore_all

log = logging.getLogger(__name__)


def upsert_listing(db, item: dict) -> Listing:
    """Insert or update a listing from a normalised scraper dict (see scraper.base.NormalisedListing)."""
    listing = (
        db.query(Listing)
        .filter(Listing.source == item["source"], Listing.source_id == item["source_id"])
        .first()
    )
    if listing is None:
        listing = Listing(source=item["source"], source_id=item["source_id"])
        db.add(listing)

    for field in (
        "url", "address", "suburb", "lat", "lng", "price", "price_text", "bedrooms",
        "bathrooms", "car_spaces", "has_garage", "land_area_m2", "floor_area_m2",
        "property_type", "description", "agent", "listing_date",
    ):
        if item.get(field) is not None:
            setattr(listing, field, item[field])
    listing.raw_json = item.get("raw_json")

    # Record price changes for negotiation signal.
    if item.get("price") is not None:
        last = (listing.price_points or [None])[-1]
        if last is None or last.price != item["price"]:
            listing.price_points.append(PricePoint(price=item["price"]))

    # Images (replace set).
    if item.get("images"):
        listing.images.clear()
        for pos, url in enumerate(item["images"]):
            listing.images.append(ListingImage(url=url, position=pos))

    # Enrichment (e.g. LINZ land area).
    enr_data = item.get("enrichment")
    if enr_data:
        enr = listing.enrichment or PropertyEnrichment()
        for k, v in enr_data.items():
            if v is not None:
                setattr(enr, k, v)
        listing.enrichment = enr
    return listing


def run_scrape(dry_run: bool = True) -> dict:
    """Run all configured scrapers. Returns a small summary dict."""
    try:
        from scraper.run import collect  # standalone package, imported lazily
    except Exception as exc:  # noqa: BLE001
        log.warning("Scraper package unavailable: %s", exc)
        return {"ok": False, "error": str(exc), "count": 0}

    items = collect()
    if dry_run:
        log.info("[dry-run] %d listings collected (not saved)", len(items))
        return {"ok": True, "dry_run": True, "count": len(items)}

    db = SessionLocal()
    try:
        for item in items:
            upsert_listing(db, item)
        db.commit()
        n = rescore_all(db)
        return {"ok": True, "saved": len(items), "rescored": n}
    finally:
        db.close()
