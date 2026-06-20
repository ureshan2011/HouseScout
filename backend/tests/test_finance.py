"""Tests for the financial engine — verified against hand calculations."""
from __future__ import annotations

import math

from app.finance import (
    BOARDER_TAX_FREE_WEEKLY,
    MAX_BOARDERS,
    Scenario,
    amortise,
    analyse,
    boarder_income,
    monthly_payment,
    rentable_rooms,
)


def test_monthly_payment_known_value():
    # $400k @ 5.19% over 30y. Closed-form check.
    pmt = monthly_payment(400_000, 0.0519, 30)
    assert math.isclose(pmt, 2192.0, abs_tol=5.0)


def test_zero_rate_payment():
    assert math.isclose(monthly_payment(360_000, 0.0, 30), 1000.0, abs_tol=0.01)


def test_amortise_payoff_term():
    res = amortise(300_000, 0.05, 30)
    assert res["payoff_months"] in (359, 360, 361)
    assert res["total_interest"] > 0


def test_extra_payments_shorten_term_and_save_interest():
    base = amortise(400_000, 0.05, 30)
    faster = amortise(400_000, 0.05, 30, extra_monthly=800)
    assert faster["payoff_months"] < base["payoff_months"]
    assert faster["total_interest"] < base["total_interest"]


def test_rentable_rooms_caps_at_four():
    assert rentable_rooms(1) == 0
    assert rentable_rooms(3) == 2
    assert rentable_rooms(6) == MAX_BOARDERS  # keep own room, capped at 4 boarders


def test_boarder_income_tax_free_threshold():
    # Rent above the IRD threshold => part is taxable.
    inc = boarder_income(bedrooms=4, weekly_rent=300)  # 3 rentable rooms
    assert inc["rentable_rooms"] == 3
    assert math.isclose(inc["weekly_tax_free"], BOARDER_TAX_FREE_WEEKLY * 3)
    assert math.isclose(inc["weekly_taxable"], (300 - BOARDER_TAX_FREE_WEEKLY) * 3)


def test_boarder_income_under_threshold_all_tax_free():
    inc = boarder_income(bedrooms=3, weekly_rent=200)  # 2 rooms, under $245
    assert inc["weekly_taxable"] == 0
    assert math.isclose(inc["weekly_tax_free"], 400.0)


def test_analyse_accelerated_beats_standard():
    s = Scenario(price=449_000, deposit=50_000, annual_rate=0.0519, term_years=30,
                 bedrooms=3, weekly_rent=220, reinvest_boarder_income=True)
    res = analyse(s)
    assert res["loan"] == 399_000
    assert res["boarder"]["rentable_rooms"] == 2
    assert res["accelerated"]["payoff_years"] <= res["standard"]["payoff_years"]
    assert res["years_saved"] >= 0
    assert res["interest_saved"] >= 0
