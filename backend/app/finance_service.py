"""Builds a finance Scenario from a listing + buyer defaults and runs analyse()."""
from __future__ import annotations

from .config import settings
from .finance import Scenario, analyse
from .models import Listing


def analyse_listing(
    listing: Listing,
    *,
    deposit: float | None = None,
    annual_rate: float | None = None,
    term_years: int | None = None,
    weekly_rent: float | None = None,
    occupancy: float = 1.0,
    reinvest_boarder_income: bool = True,
) -> dict:
    scenario = Scenario(
        price=listing.price or settings.preapproval,
        deposit=deposit if deposit is not None else settings.deposit,
        annual_rate=annual_rate if annual_rate is not None else settings.default_mortgage_rate,
        term_years=term_years or settings.default_term_years,
        bedrooms=listing.bedrooms,
        weekly_rent=weekly_rent if weekly_rent is not None else settings.boarder_weekly_rent,
        occupancy=occupancy,
        reinvest_boarder_income=reinvest_boarder_income,
    )
    return analyse(scenario)
