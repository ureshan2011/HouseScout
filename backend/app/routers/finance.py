"""Financial analysis endpoints (mortgage + boarder + accelerated payoff)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..finance import Scenario, analyse
from ..finance_service import analyse_listing
from ..models import Listing
from ..schemas import FinanceRequest

router = APIRouter(prefix="/api/finance", tags=["finance"])


@router.get("/defaults")
def defaults():
    return {
        "deposit": settings.deposit,
        "annual_rate": settings.default_mortgage_rate,
        "term_years": settings.default_term_years,
        "weekly_rent": settings.boarder_weekly_rent,
        "max_price": settings.max_price,
        "preapproval": settings.preapproval,
    }


@router.get("/listing/{listing_id}")
def finance_for_listing(
    listing_id: int,
    db: Session = Depends(get_db),
    deposit: float | None = None,
    annual_rate: float | None = None,
    term_years: int | None = None,
    weekly_rent: float | None = None,
    occupancy: float = 1.0,
    reinvest: bool = True,
):
    listing = db.get(Listing, listing_id)
    if not listing:
        raise HTTPException(404, "Listing not found")
    return analyse_listing(
        listing, deposit=deposit, annual_rate=annual_rate, term_years=term_years,
        weekly_rent=weekly_rent, occupancy=occupancy, reinvest_boarder_income=reinvest,
    )


@router.post("/scenario")
def scenario(req: FinanceRequest):
    """Ad-hoc scenario for the planner page (no listing required)."""
    s = Scenario(
        price=req.price,
        deposit=req.deposit if req.deposit is not None else settings.deposit,
        annual_rate=req.annual_rate if req.annual_rate is not None else settings.default_mortgage_rate,
        term_years=req.term_years or settings.default_term_years,
        bedrooms=req.bedrooms,
        weekly_rent=req.weekly_rent if req.weekly_rent is not None else settings.boarder_weekly_rent,
        occupancy=req.occupancy,
        reinvest_boarder_income=req.reinvest_boarder_income,
    )
    return analyse(s)
