"""Financial engine — pure functions, no DB or I/O so they are trivially testable.

Models the buyer's strategy: live in the house, rent spare rooms to boarders, and
funnel that income into extra mortgage repayments to be debt-free as fast as possible.

NZ-specific: IRD "standard-cost" method makes boarder income up to a weekly
threshold per boarder effectively tax-free (max 4 boarders). 2025-26 threshold = $245/wk.
Ref: https://www.ird.govt.nz/property/renting-out-residential-property/...standard-cost-method-for-boarders-and-home-stay-students
"""
from __future__ import annotations

from dataclasses import dataclass, field

# IRD standard-cost weekly amount per boarder (2025-26 income year) and boarder cap.
BOARDER_TAX_FREE_WEEKLY = 245.0
MAX_BOARDERS = 4
WEEKS_PER_YEAR = 52
MONTHS_PER_YEAR = 12


# --------------------------------------------------------------------------- #
# Mortgage
# --------------------------------------------------------------------------- #
def monthly_payment(principal: float, annual_rate: float, term_years: int) -> float:
    """Standard amortising P&I monthly payment."""
    if principal <= 0:
        return 0.0
    n = term_years * MONTHS_PER_YEAR
    r = annual_rate / MONTHS_PER_YEAR
    if r == 0:
        return principal / n
    return principal * r * (1 + r) ** n / ((1 + r) ** n - 1)


def amortise(
    principal: float,
    annual_rate: float,
    term_years: int,
    extra_monthly: float = 0.0,
) -> dict:
    """Run an amortisation schedule, optionally with a fixed extra monthly payment.

    Returns total interest paid, months to payoff, and a yearly balance trace.
    """
    base_pmt = monthly_payment(principal, annual_rate, term_years)
    r = annual_rate / MONTHS_PER_YEAR
    balance = principal
    total_interest = 0.0
    months = 0
    yearly_balance: list[float] = [round(balance, 2)]
    max_months = term_years * MONTHS_PER_YEAR + 1

    while balance > 0.005 and months < max_months * 2:
        interest = balance * r
        payment = base_pmt + extra_monthly
        principal_paid = payment - interest
        if principal_paid <= 0:  # payment can't cover interest -> never pays off
            return {
                "monthly_payment": round(base_pmt, 2),
                "payoff_months": None,
                "payoff_years": None,
                "total_interest": None,
                "yearly_balance": yearly_balance,
            }
        if principal_paid > balance:  # final partial payment
            principal_paid = balance
        balance -= principal_paid
        total_interest += interest
        months += 1
        if months % 12 == 0:
            yearly_balance.append(round(max(balance, 0.0), 2))

    if months % 12 != 0:
        yearly_balance.append(round(max(balance, 0.0), 2))

    return {
        "monthly_payment": round(base_pmt, 2),
        "payoff_months": months,
        "payoff_years": round(months / 12, 1),
        "total_interest": round(total_interest, 2),
        "yearly_balance": yearly_balance,
    }


# --------------------------------------------------------------------------- #
# Boarder income (rent the spare rooms)
# --------------------------------------------------------------------------- #
def rentable_rooms(bedrooms: int | None) -> int:
    """You keep one bedroom; the rest can host boarders (capped at IRD's 4)."""
    if not bedrooms or bedrooms < 2:
        return 0
    return min(bedrooms - 1, MAX_BOARDERS)


def boarder_income(
    bedrooms: int | None,
    weekly_rent: float,
    occupancy: float = 1.0,
) -> dict:
    """Weekly/annual boarder income split into tax-free and taxable portions."""
    rooms = rentable_rooms(bedrooms)
    gross_weekly = rooms * weekly_rent * occupancy
    tax_free_weekly = min(weekly_rent, BOARDER_TAX_FREE_WEEKLY) * rooms * occupancy
    taxable_weekly = max(gross_weekly - tax_free_weekly, 0.0)
    return {
        "rentable_rooms": rooms,
        "weekly_gross": round(gross_weekly, 2),
        "weekly_tax_free": round(tax_free_weekly, 2),
        "weekly_taxable": round(taxable_weekly, 2),
        "annual_gross": round(gross_weekly * WEEKS_PER_YEAR, 2),
    }


# --------------------------------------------------------------------------- #
# Full scenario
# --------------------------------------------------------------------------- #
@dataclass
class Scenario:
    price: float
    deposit: float
    annual_rate: float
    term_years: int
    bedrooms: int | None
    weekly_rent: float
    occupancy: float = 1.0
    annual_rates_bill: float = 3200.0  # council rates
    annual_insurance: float = 2200.0
    annual_maintenance_pct: float = 0.01  # of value
    # If True, all net boarder surplus is thrown at the mortgage (payoff ASAP).
    reinvest_boarder_income: bool = True
    extra_components: dict = field(default_factory=dict)

    @property
    def loan(self) -> float:
        return max(self.price - self.deposit, 0.0)


def analyse(s: Scenario) -> dict:
    """Produce the full financial picture for a listing under the rent-rooms strategy."""
    loan = s.loan
    base = amortise(loan, s.annual_rate, s.term_years)
    income = boarder_income(s.bedrooms, s.weekly_rent, s.occupancy)

    monthly_pmt = base["monthly_payment"]
    monthly_income = income["weekly_gross"] * WEEKS_PER_YEAR / MONTHS_PER_YEAR
    monthly_holding = (
        s.annual_rates_bill
        + s.annual_insurance
        + s.price * s.annual_maintenance_pct
    ) / MONTHS_PER_YEAR

    # Surplus available to accelerate the mortgage (income minus holding costs).
    net_surplus_monthly = max(monthly_income - monthly_holding, 0.0)
    extra = net_surplus_monthly if s.reinvest_boarder_income else 0.0
    accelerated = amortise(loan, s.annual_rate, s.term_years, extra_monthly=extra)

    # Out-of-pocket = mortgage + holding - boarder income (negative => income covers it).
    net_monthly_outlay = monthly_pmt + monthly_holding - monthly_income

    gross_yield = (
        income["annual_gross"] / s.price * 100 if s.price else 0.0
    )
    annual_costs = (
        monthly_pmt * MONTHS_PER_YEAR + monthly_holding * MONTHS_PER_YEAR
    )
    net_annual = income["annual_gross"] - annual_costs

    interest_saved = None
    years_saved = None
    if base["total_interest"] and accelerated["total_interest"] is not None:
        interest_saved = round(base["total_interest"] - accelerated["total_interest"], 2)
    if base["payoff_years"] and accelerated["payoff_years"]:
        years_saved = round(base["payoff_years"] - accelerated["payoff_years"], 1)

    return {
        "loan": round(loan, 2),
        "monthly_payment": monthly_pmt,
        "boarder": income,
        "monthly_boarder_income": round(monthly_income, 2),
        "monthly_holding_costs": round(monthly_holding, 2),
        "net_monthly_outlay": round(net_monthly_outlay, 2),
        "covers_mortgage": net_monthly_outlay <= 0,
        "gross_yield_pct": round(gross_yield, 2),
        "net_annual_cashflow": round(net_annual, 2),
        "standard": base,
        "accelerated": accelerated,
        "interest_saved": interest_saved,
        "years_saved": years_saved,
    }
