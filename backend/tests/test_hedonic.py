"""Tests for the valuation model trainer (scripts/hedonic.py).

The model is the core of the paid product, so the properties that matter are the
ones that keep it honest: it must not train on prices we invented, it must shrink
toward documented priors when the sample is thin, and it must not advertise
confidence it hasn't earned.
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import hedonic  # noqa: E402


def listing(**kw) -> dict:
    base = {
        "source_id": "43070799",
        "suburb": "Hornby",
        "bedrooms": 3,
        "bathrooms": 1,
        "land_area_m2": 600,
        "floor_area_m2": 110,
        "has_garage": True,
        "property_type": "house",
        "price": 450_000,
        "price_text": "Asking Price $450,000",
        "provenance": {"price": "observed", "record": "scraped"},
    }
    base.update(kw)
    return base


# --------------------------------------------------------------------------- #
# Linear algebra
# --------------------------------------------------------------------------- #
def test_solve_recovers_known_solution():
    a = [[2.0, 1.0], [1.0, 3.0]]
    b = [5.0, 10.0]  # x = [1, 3]
    x = hedonic.solve(a, b)
    assert x is not None
    assert x[0] == pytest.approx(1.0)
    assert x[1] == pytest.approx(3.0)


def test_solve_returns_none_for_singular_matrix():
    assert hedonic.solve([[1.0, 2.0], [2.0, 4.0]], [1.0, 2.0]) is None


def test_ridge_with_no_data_returns_the_prior():
    prior = [0.5, -0.25]
    assert hedonic.ridge_to_prior([], [], prior, lam=1.0) == pytest.approx(prior)


def test_ridge_shrinks_toward_prior_as_lambda_grows():
    # One observation pulling hard away from a prior of zero.
    xs, ys, prior = [[1.0]], [10.0], [0.0]
    weak = hedonic.ridge_to_prior(xs, ys, prior, lam=0.01)[0]
    strong = hedonic.ridge_to_prior(xs, ys, prior, lam=1000.0)[0]
    assert weak > strong
    assert strong == pytest.approx(0.0, abs=0.05)


# --------------------------------------------------------------------------- #
# Training-target selection — the honesty guarantee
# --------------------------------------------------------------------------- #
def test_observed_price_accepts_a_published_figure():
    assert hedonic.observed_price(listing()) == 450_000.0


@pytest.mark.parametrize("text", ["Deadline Sale", "Auction", "By Negotiation", "POA", ""])
def test_observed_price_rejects_listings_with_no_published_figure(text):
    l = listing(price_text=text, provenance={"price": "modelled", "record": "scraped"})
    assert hedonic.observed_price(l) is None


def test_observed_price_still_rejects_legacy_sample_records():
    """Belt and braces: hand-written records are gone, but a stale corpus may exist."""
    l = listing(source_id="SEED-hornby-01", provenance={"price": "observed", "record": "sample"})
    assert hedonic.observed_price(l) is None


def test_observed_price_falls_back_to_regex_without_provenance():
    assert hedonic.observed_price(listing(provenance=None)) == 450_000.0
    assert hedonic.observed_price(listing(provenance=None, price_text="Auction")) is None
    assert hedonic.observed_price(
        listing(provenance=None, source_id="SEED-x", price_text="Asking Price $450,000")
    ) is None


# --------------------------------------------------------------------------- #
# Feature extraction
# --------------------------------------------------------------------------- #
MEDIANS = {"land": 500.0, "floor": 100.0, "bedrooms": 3.0, "bathrooms": 1.0}


def test_design_row_is_all_zeros_for_the_reference_property():
    """Features are centred, so the reference property is the origin."""
    row = hedonic.design_row(
        {
            "suburb": None,  # -> city median
            "bedrooms": MEDIANS["bedrooms"],
            "bathrooms": MEDIANS["bathrooms"],
            "land_area_m2": MEDIANS["land"],
            "floor_area_m2": MEDIANS["floor"],
            "has_garage": True,
            "property_type": "house",
        },
        MEDIANS,
    )
    assert row[0] == 1.0  # intercept
    assert all(v == pytest.approx(0.0) for v in row[1:])


def test_design_row_imputes_dataset_medians_for_missing_fields():
    # Missing numerics become the median, which after centring is a zero deviation.
    row = hedonic.design_row(
        {"suburb": None, "property_type": "house", "has_garage": True}, MEDIANS
    )
    features = dict(zip(hedonic.FEATURES, row))
    assert features["bedrooms"] == pytest.approx(0.0)
    assert features["log_land"] == pytest.approx(0.0)
    assert features["log_floor"] == pytest.approx(0.0)


def test_design_row_prefers_enriched_land_area():
    row = hedonic.design_row(
        {"suburb": "Hornby", "land_area_m2": 300, "enrichment": {"land_area_m2": 800}}, MEDIANS
    )
    expected = math.log1p(800) - math.log1p(MEDIANS["land"])
    assert dict(zip(hedonic.FEATURES, row))["log_land"] == pytest.approx(expected)


def test_design_row_centres_garage_so_missing_one_is_a_penalty():
    with_garage = dict(zip(hedonic.FEATURES, hedonic.design_row({"has_garage": True}, MEDIANS)))
    without = dict(zip(hedonic.FEATURES, hedonic.design_row({"has_garage": False}, MEDIANS)))
    assert with_garage["has_garage"] == pytest.approx(0.0)
    assert without["has_garage"] == pytest.approx(-1.0)


def test_reference_price_is_immune_to_coefficient_drift():
    """Regression test for an ~8% valuation bias.

    With un-centred features, ``log_suburb_median`` was a raw value near 13 and the
    intercept was anchored using the *prior* coefficients. Once fitting nudged that
    coefficient by 0.006, every prediction shifted by 13 * 0.006 = 0.08 in log space
    — about 8% — with nothing in the coefficient table looking wrong.

    Centred, the reference property is the origin, so its price is exp(intercept)
    no matter what the other coefficients do.
    """
    row = hedonic.design_row(
        {
            "suburb": None,
            "bedrooms": MEDIANS["bedrooms"],
            "bathrooms": MEDIANS["bathrooms"],
            "land_area_m2": MEDIANS["land"],
            "floor_area_m2": MEDIANS["floor"],
            "has_garage": True,
            "property_type": "house",
        },
        MEDIANS,
    )
    intercept = 13.0
    for drift in (0.0, 0.006, 0.05, -0.05):
        beta = [intercept] + [hedonic.PRIORS[f] + drift for f in hedonic.FEATURES[1:]]
        predicted = math.exp(sum(b * v for b, v in zip(beta, row)))
        assert predicted == pytest.approx(math.exp(intercept))


def test_property_type_dummies_are_mutually_exclusive():
    medians = {"land": 500.0, "floor": 100.0, "bedrooms": 3.0, "bathrooms": 1.0}
    for ptype in ("house", "unit", "townhouse", "apartment"):
        f = dict(zip(hedonic.FEATURES, hedonic.design_row({"property_type": ptype}, medians)))
        assert f["is_unit"] + f["is_townhouse"] + f["is_apartment"] == (0 if ptype == "house" else 1)


def test_unknown_suburb_falls_back_to_the_city_median():
    assert hedonic.suburb_median("Nowhere-ville") == hedonic.CITY_MEDIAN
    assert hedonic.suburb_median("Aranui") == hedonic.SUBURB_STATS["Aranui"]["median"]


# --------------------------------------------------------------------------- #
# Training end to end
# --------------------------------------------------------------------------- #
def test_train_with_no_observed_prices_serves_unfitted_priors():
    corpus = [listing(price_text="Auction", provenance={"price": "modelled", "record": "scraped"})] * 20
    model = hedonic.train(corpus)
    assert model["fitted"] is False
    assert model["n_train"] == 0
    assert model["confidence"] == "low"
    # The suburb coefficient should still be the documented prior.
    assert model["coefficients"]["log_suburb_median"] == pytest.approx(
        hedonic.PRIORS["log_suburb_median"]
    )


def test_unfitted_prior_prices_a_median_house_at_the_city_median():
    """With no data to learn from, the reference property prices at the reference."""
    model = hedonic.train([])
    medians = hedonic.dataset_medians([])
    row = hedonic.design_row(
        {
            "suburb": None,
            "bedrooms": medians["bedrooms"],
            "bathrooms": medians["bathrooms"],
            "land_area_m2": medians["land"],
            "floor_area_m2": medians["floor"],
            "has_garage": True,
            "property_type": "house",
        },
        medians,
    )
    beta = [model["coefficients"][f] for f in hedonic.FEATURES]
    predicted = math.exp(sum(b * v for b, v in zip(beta, row)))
    assert predicted == pytest.approx(hedonic.CITY_MEDIAN, rel=0.001)


def test_a_suburb_above_the_city_median_prices_above_the_reference():
    model = hedonic.train([])
    medians = hedonic.dataset_medians([])
    beta = [model["coefficients"][f] for f in hedonic.FEATURES]

    def value(suburb: str | None) -> float:
        row = hedonic.design_row(
            {
                "suburb": suburb,
                "bedrooms": medians["bedrooms"],
                "bathrooms": medians["bathrooms"],
                "land_area_m2": medians["land"],
                "floor_area_m2": medians["floor"],
                "has_garage": True,
                "property_type": "house",
            },
            medians,
        )
        return math.exp(sum(b * v for b, v in zip(beta, row)))

    # Papanui ($490k median) > city ($455k) > Aranui ($410k).
    assert value("Papanui") > value(None) > value("Aranui")


def test_valuations_stay_in_the_neighbourhood_of_the_suburb_median():
    """A median-featured house must not be valued wildly away from its suburb.

    This is the user-visible symptom the centring fix addressed: valuations were
    landing 20%+ above suburb medians, which made every listing look like a bargain.
    """
    model = hedonic.train([])
    medians = hedonic.dataset_medians([])
    beta = [model["coefficients"][f] for f in hedonic.FEATURES]

    for suburb, stats in hedonic.SUBURB_STATS.items():
        row = hedonic.design_row(
            {
                "suburb": suburb,
                "bedrooms": medians["bedrooms"],
                "bathrooms": medians["bathrooms"],
                "land_area_m2": medians["land"],
                "floor_area_m2": medians["floor"],
                "has_garage": True,
                "property_type": "house",
            },
            medians,
        )
        predicted = math.exp(sum(b * v for b, v in zip(beta, row)))
        assert predicted == pytest.approx(stats["median"], rel=0.02), suburb


def test_train_reports_honest_confidence_on_a_small_sample():
    corpus = [
        listing(source_id=str(43070000 + i), price=430_000 + i * 5_000,
                price_text=f"Asking Price ${430_000 + i * 5_000:,}")
        for i in range(6)
    ]
    model = hedonic.train(corpus)
    assert model["fitted"] is True
    assert model["n_train"] == 6
    # Six observations can never advertise better than low confidence.
    assert model["confidence"] == "low"
    assert model["band"] >= 0.18


def test_confidence_band_tightens_only_with_sample_size():
    low_n, low_band = hedonic.confidence_band(10, 0.01)
    mid_n, mid_band = hedonic.confidence_band(30, 0.01)
    hi_n, hi_band = hedonic.confidence_band(100, 0.01)
    assert (low_n, mid_n, hi_n) == ("low", "medium", "high")
    assert low_band > mid_band > hi_band


def test_confidence_band_widens_when_cross_validated_error_is_high():
    _, tight = hedonic.confidence_band(100, 0.01)
    level, wide = hedonic.confidence_band(100, 0.30)
    assert wide > tight
    # High error must not be reported as high confidence just because n is large.
    assert level == "low"


def test_more_bedrooms_predicts_a_higher_value():
    model = hedonic.train([])
    medians = hedonic.dataset_medians([])
    beta = [model["coefficients"][f] for f in hedonic.FEATURES]

    def value(beds: int) -> float:
        row = hedonic.design_row(listing(bedrooms=beds), medians)
        return math.exp(sum(b * v for b, v in zip(beta, row)))

    assert value(4) > value(3) > value(2)


def test_a_townhouse_is_valued_below_an_equivalent_house():
    model = hedonic.train([])
    medians = hedonic.dataset_medians([])
    beta = [model["coefficients"][f] for f in hedonic.FEATURES]

    def value(ptype: str) -> float:
        row = hedonic.design_row(listing(property_type=ptype), medians)
        return math.exp(sum(b * v for b, v in zip(beta, row)))

    assert value("townhouse") < value("house")
    assert value("apartment") < value("townhouse")


def test_write_price_estimates_fills_every_listing():
    model = hedonic.train([])
    medians = hedonic.dataset_medians([])
    corpus = [
        listing(price=None, price_text="Auction"),
        listing(price=450_000, price_text="Asking Price $450,000"),
    ]
    unpriced = hedonic.write_price_estimates(corpus, model["coefficients"], medians)
    assert unpriced == 1
    for l in corpus:
        assert l["price_estimate"] > 100_000
    # `price` is never overwritten — a published figure stays published, and a null
    # stays null so the UI can tell the two apart.
    assert corpus[0]["price"] is None
    assert corpus[1]["price"] == 450_000


def test_price_estimate_tracks_the_suburb():
    model = hedonic.train([])
    medians = hedonic.dataset_medians([])
    cheap = listing(suburb="Aranui", price=None, price_text="Auction")
    dear = listing(suburb="Fendalton", price=None, price_text="Auction")
    hedonic.write_price_estimates([cheap, dear], model["coefficients"], medians)
    assert dear["price_estimate"] > cheap["price_estimate"]


def test_dataset_medians_ignore_missing_values():
    corpus = [
        listing(land_area_m2=None, floor_area_m2=None),
        listing(land_area_m2=400, floor_area_m2=90),
        listing(land_area_m2=600, floor_area_m2=130),
    ]
    medians = hedonic.dataset_medians(corpus)
    assert 400 <= medians["land"] <= 600
    assert 90 <= medians["floor"] <= 130
