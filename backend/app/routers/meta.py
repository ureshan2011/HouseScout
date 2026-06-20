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
