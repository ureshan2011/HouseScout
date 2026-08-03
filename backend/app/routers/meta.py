"""Reference data + dashboard stats + scrape trigger."""
from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Listing, MortgageRate, Score, Suburb
from ..schemas import RateOut, SuburbOut

router = APIRouter(prefix="/api", tags=["meta"])


@router.get("/suburbs", response_model=list[SuburbOut])
def suburbs(db: Session = Depends(get_db)):
    return db.query(Suburb).order_by(Suburb.median_price.asc()).all()


@router.get("/rates", response_model=list[RateOut])
def rates(db: Session = Depends(get_db)):
    return db.query(MortgageRate).order_by(MortgageRate.rate.asc()).all()


@router.get("/regions")
def regions(db: Session = Depends(get_db)):
    """The district catalogue, plus which districts this deployment covers and holds.

    `available` is every district the scraper knows how to search; `configured` is the
    SCRAPE_REGIONS selection; `stored` counts what is actually in the database, which
    is what a region filter should be built from.
    """
    from ..config import settings
    from scraper.regions import region_choices

    counts = dict(
        db.query(Listing.region, func.count(Listing.id))
        .filter(Listing.region.is_not(None))
        .group_by(Listing.region)
        .all()
    )
    return {
        "available": region_choices(),
        "configured": [r.key for r in settings.regions],
        "stored": [{"key": k, "count": n} for k, n in sorted(counts.items())],
    }


@router.get("/stats")
def stats(db: Session = Depends(get_db)):
    total = db.scalar(select(func.count(Listing.id))) or 0
    passing = db.scalar(
        select(func.count(Score.id)).where(Score.passes_filters.is_(True))
    ) or 0
    avg_price = db.scalar(
        select(func.avg(Listing.price)).join(Score).where(Score.passes_filters.is_(True))
    )
    top = (
        db.query(Listing)
        .join(Score)
        .filter(Score.passes_filters.is_(True))
        .order_by(Score.match_score.desc())
        .limit(3)
        .all()
    )
    return {
        "total_listings": total,
        "matching_listings": passing,
        "avg_matching_price": round(avg_price, 0) if avg_price else None,
        "top": [
            {"id": t.id, "address": t.address, "suburb": t.suburb, "price": t.price,
             "score": t.score.match_score if t.score else None}
            for t in top
        ],
    }


@router.post("/scrape")
def trigger_scrape(background: BackgroundTasks, dry_run: bool = True):
    """Kick off a scrape in the background. Wired to scraper.run when keys are set."""
    from ..scraper_hook import run_scrape

    background.add_task(run_scrape, dry_run)
    return {"started": True, "dry_run": dry_run}


@router.post("/rates/refresh")
def refresh_rates_now():
    """Scrape interest.co.nz and update the mortgage rate table."""
    from ..scraper_hook import refresh_rates

    return refresh_rates()
