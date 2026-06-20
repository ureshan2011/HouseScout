"""Bridges ORM Listing rows to the pure scoring functions and persists Score rows."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy.orm import Session

from .models import Listing, Score
from .scoring import Criteria, score_listing


def listing_to_dict(listing: Listing) -> dict:
    """Flatten an ORM listing (plus enrichment) into the dict the scorer expects."""
    enr = listing.enrichment
    days = None
    if listing.listing_date:
        days = (datetime.utcnow() - listing.listing_date).days
    return {
        "id": listing.id,
        "price": listing.price,
        "bedrooms": listing.bedrooms,
        "has_garage": listing.has_garage,
        "land_area_m2": listing.land_area_m2,
        "property_type": listing.property_type,
        "days_on_market": days,
        "enrichment": {
            "land_area_m2": enr.land_area_m2 if enr else None,
            "estimate_value": enr.estimate_value if enr else None,
            "rateable_value": enr.rateable_value if enr else None,
        },
    }


def rescore_all(db: Session, criteria: Criteria | None = None) -> int:
    """Recompute and persist match scores for every listing. Returns count."""
    c = criteria or Criteria()
    listings = db.query(Listing).all()
    for listing in listings:
        result = score_listing(listing_to_dict(listing), c)
        score = listing.score or Score(listing_id=listing.id)
        score.match_score = result["match_score"]
        score.passes_filters = result["passes_filters"]
        score.components = {
            "components": result["components"],
            "failed_filters": result["failed_filters"],
            "rentable_rooms": result["rentable_rooms"],
        }
        db.add(score)
    db.commit()
    return len(listings)
