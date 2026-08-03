"""Listing browse / detail / rescore endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from ..db import get_db
from ..models import Listing, Score
from ..schemas import ListingOut
from ..scoring import Criteria
from ..scoring_service import rescore_all

router = APIRouter(prefix="/api/listings", tags=["listings"])


def _csv(value: str | None) -> list[str]:
    """A comma-separated multi-select parameter -> a list of values."""
    if not value:
        return []
    return [v.strip() for v in value.split(",") if v.strip()]


@router.get("", response_model=list[ListingOut])
def list_listings(
    db: Session = Depends(get_db),
    # Multi-select params accept a comma-separated list, matching the static
    # frontend's query strings (frontend/lib/api.ts) so a URL is portable between
    # the two. An absent parameter never filters.
    region: str | None = Query(None, description="District key(s), comma separated"),
    suburb: str | None = Query(None, description="Suburb name(s), comma separated"),
    property_type: str | None = Query(None, description="Type(s), comma separated"),
    q: str | None = Query(None, description="Free-text over address, suburb, description"),
    min_price: float | None = None,
    max_price: float | None = None,
    min_bedrooms: int | None = None,
    max_bedrooms: int | None = None,
    min_bathrooms: int | None = None,
    min_land: float | None = None,
    max_land: float | None = None,
    garage_only: bool = False,
    priced_only: bool = Query(False, description="Only listings with a published price"),
    passes_only: bool = True,
    sort: str = Query("score", pattern="^(score|price|price_desc|newest|land|bedrooms)$"),
    limit: int = Query(60, le=200),
    offset: int = 0,
):
    stmt = (
        select(Listing)
        .options(
            selectinload(Listing.images),
            selectinload(Listing.enrichment),
            selectinload(Listing.score),
        )
        .join(Score, isouter=True)
        .where(Listing.status == "active")
    )
    if regions := _csv(region):
        stmt = stmt.where(Listing.region.in_(regions))
    if suburbs := _csv(suburb):
        stmt = stmt.where(Listing.suburb.in_(suburbs))
    if types := _csv(property_type):
        stmt = stmt.where(Listing.property_type.in_(types))
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                Listing.address.ilike(like),
                Listing.suburb.ilike(like),
                Listing.description.ilike(like),
            )
        )
    if min_price is not None:
        stmt = stmt.where(Listing.price >= min_price)
    if max_price is not None:
        stmt = stmt.where(Listing.price <= max_price)
    if min_bedrooms is not None:
        stmt = stmt.where(Listing.bedrooms >= min_bedrooms)
    if max_bedrooms is not None:
        stmt = stmt.where(Listing.bedrooms <= max_bedrooms)
    if min_bathrooms is not None:
        stmt = stmt.where(Listing.bathrooms >= min_bathrooms)
    # An unknown land area is not evidence of a small section, so it is kept rather
    # than excluded — same rule as the frontend filter.
    if min_land is not None:
        stmt = stmt.where(or_(Listing.land_area_m2.is_(None), Listing.land_area_m2 >= min_land))
    if max_land is not None:
        stmt = stmt.where(or_(Listing.land_area_m2.is_(None), Listing.land_area_m2 <= max_land))
    if garage_only:
        stmt = stmt.where(Listing.has_garage.is_(True))
    if priced_only:
        stmt = stmt.where(Listing.price.is_not(None))
    if passes_only:
        stmt = stmt.where(Score.passes_filters.is_(True))

    if sort == "score":
        stmt = stmt.order_by(Score.match_score.desc().nullslast())
    elif sort == "price":
        stmt = stmt.order_by(Listing.price.asc().nullslast())
    elif sort == "price_desc":
        stmt = stmt.order_by(Listing.price.desc().nullslast())
    elif sort == "newest":
        stmt = stmt.order_by(Listing.listing_date.desc().nullslast())
    elif sort == "land":
        stmt = stmt.order_by(Listing.land_area_m2.desc().nullslast())
    elif sort == "bedrooms":
        stmt = stmt.order_by(Listing.bedrooms.desc().nullslast())

    rows = db.execute(stmt.offset(offset).limit(limit)).scalars().unique().all()
    return rows


@router.get("/{listing_id}", response_model=ListingOut)
def get_listing(listing_id: int, db: Session = Depends(get_db)):
    listing = db.get(Listing, listing_id)
    if not listing:
        raise HTTPException(404, "Listing not found")
    return listing


@router.post("/rescore")
def rescore(
    db: Session = Depends(get_db),
    max_price: float | None = None,
    preapproval: float | None = None,
    min_backyard_m2: float | None = None,
    require_garage: bool = True,
    require_backyard: bool = True,
    allow_townhouse: bool = True,
):
    """Re-score every listing against supplied criteria.

    The full Criteria surface is exposed, mirroring the buyer-profile form in the
    static frontend (frontend/lib/criteria.ts) — min_backyard_m2 and preapproval used
    to be fixed at their defaults here even though the scoring engine reads both.
    """
    c = Criteria(allow_townhouse=allow_townhouse, require_garage=require_garage,
                 require_backyard=require_backyard)
    if max_price is not None:
        c.max_price = max_price
    if preapproval is not None:
        c.preapproval = preapproval
    if min_backyard_m2 is not None:
        c.min_backyard_m2 = min_backyard_m2
    n = rescore_all(db, c)
    return {"rescored": n}
