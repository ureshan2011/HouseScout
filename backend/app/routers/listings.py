"""Listing browse / detail / rescore endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..db import get_db
from ..models import Listing, Score
from ..schemas import ListingOut
from ..scoring import Criteria
from ..scoring_service import rescore_all

router = APIRouter(prefix="/api/listings", tags=["listings"])


@router.get("", response_model=list[ListingOut])
def list_listings(
    db: Session = Depends(get_db),
    suburb: str | None = None,
    property_type: str | None = None,
    max_price: float | None = None,
    min_bedrooms: int | None = None,
    garage_only: bool = False,
    passes_only: bool = True,
    sort: str = Query("score", pattern="^(score|price|price_desc|newest)$"),
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
    if suburb:
        stmt = stmt.where(Listing.suburb == suburb)
    if property_type:
        stmt = stmt.where(Listing.property_type == property_type)
    if max_price is not None:
        stmt = stmt.where(Listing.price <= max_price)
    if min_bedrooms is not None:
        stmt = stmt.where(Listing.bedrooms >= min_bedrooms)
    if garage_only:
        stmt = stmt.where(Listing.has_garage.is_(True))
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
    require_garage: bool = True,
    require_backyard: bool = True,
    allow_townhouse: bool = True,
):
    c = Criteria(allow_townhouse=allow_townhouse, require_garage=require_garage,
                 require_backyard=require_backyard)
    if max_price is not None:
        c.max_price = max_price
    n = rescore_all(db, c)
    return {"rescored": n}
