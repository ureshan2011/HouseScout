#!/usr/bin/env python3
"""HouseScout valuation model — trained at build time, served to the browser.

This replaces the "ask a chat model what it thinks the house is worth" approach with
a real quantitative model that runs entirely inside the app: it is deterministic,
explainable feature-by-feature, costs nothing per query, and works offline.

Model
-----
A log-linear hedonic price model, fitted on **centred** features::

    log(price) = log(reference price)
               + b_suburb  * (log(suburb median) - log(city median))
               + b_bed     * (bedrooms  - median bedrooms)
               + b_bath    * (bathrooms - median bathrooms)
               + b_land    * (log1p(land m2)  - log1p(median land))
               + b_floor   * (log1p(floor m2) - log1p(median floor))
               + b_garage  * (has_garage - 1)
               + type dummies (unit / townhouse / apartment; house is the base)

Working in logs makes every coefficient a *proportional* effect (an extra bedroom is
worth a percentage, not a flat dollar amount), which is how residential property
actually behaves and which keeps the model sane when extrapolating.

Centring every feature on a reference property — a median-featured, garaged house in
a median-priced suburb — matters more than it looks. See ``design_row``.

Why ridge-toward-prior
----------------------
The honest constraint on this dataset is sample size: most Christchurch sub-$500k
listings sell by Deadline Sale or Auction and publish **no asking price at all**, so
only a small minority of rows carry a genuinely observed price. Fitting nine free
coefficients to a handful of observations by ordinary least squares would overfit
spectacularly and produce confident nonsense.

So instead of fitting from scratch we shrink toward documented priors::

    minimise  ||y - Xb||^2 + lambda * ||b - b_prior||^2
    solution  b = (X'X + lambda*I)^-1 (X'y + lambda*b_prior)

The priors encode published NZ residential valuation relationships (see PRIORS).
With very little real data the model stays close to those documented relationships;
as genuine scraped asking prices accumulate it moves toward what the market actually
did. lambda is chosen by k-fold cross-validation, so the data decides how much it is
trusted rather than the author deciding.

The emitted model carries its own honesty metadata — ``n_train``, cross-validated
R^2/MAE and a ``confidence`` band — so the UI can label a low-confidence estimate as
such instead of presenting every number as a valuation.

Output: ``frontend/public/model.json``, consumed by ``frontend/lib/predict.ts``.
"""
from __future__ import annotations

import json
import math
import re
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
PUBLIC_DIR = REPO_ROOT / "frontend" / "public"
LISTINGS_JSON = PUBLIC_DIR / "listings.json"
OUT_JSON = PUBLIC_DIR / "model.json"

# --------------------------------------------------------------------------- #
# Reference data — Christchurch suburb medians, yields and growth.
# Kept in step with frontend/lib/data.ts (SUBURBS) and docs/DATA_SOURCES.md.
# These are indicative reference figures, labelled as such in the UI.
# --------------------------------------------------------------------------- #
#
# Coverage matters more than it looks: an unlisted suburb falls back to the city
# median, so a premium suburb like Fendalton would be valued as if it were an average
# one. Since ingestion now reaches above the buyer's cap (see api_scrapers), the
# higher-priced suburbs need to be here too, not just the affordable ones.
SUBURB_STATS: dict[str, dict[str, float]] = {
    "Addington":            {"median": 440_000, "yield": 5.3, "growth": 5.0, "cbd_km": 2.0},
    "Aranui":               {"median": 410_000, "yield": 5.8, "growth": 8.0, "cbd_km": 8.5},
    "Avondale":             {"median": 420_000, "yield": 5.4, "growth": 7.0, "cbd_km": 7.0},
    "Avonhead":             {"median": 495_000, "yield": 4.6, "growth": 5.0, "cbd_km": 7.5},
    "Avonside":            {"median": 420_000, "yield": 5.5, "growth": 6.0, "cbd_km": 3.5},
    "Beckenham":            {"median": 480_000, "yield": 4.8, "growth": 5.0, "cbd_km": 4.0},
    "Belfast":              {"median": 480_000, "yield": 4.9, "growth": 8.0, "cbd_km": 12.0},
    "Bishopdale":           {"median": 490_000, "yield": 4.9, "growth": 7.0, "cbd_km": 6.0},
    "Burwood":              {"median": 450_000, "yield": 5.3, "growth": 7.5, "cbd_km": 7.0},
    "Casebrook":            {"median": 470_000, "yield": 4.8, "growth": 6.5, "cbd_km": 9.0},
    "Cashmere":             {"median": 495_000, "yield": 4.3, "growth": 4.5, "cbd_km": 5.0},
    "Christchurch Central": {"median": 440_000, "yield": 5.0, "growth": 5.0, "cbd_km": 0.5},
    "Dallington":           {"median": 420_000, "yield": 5.3, "growth": 6.0, "cbd_km": 5.0},
    "Edgeware":             {"median": 440_000, "yield": 5.0, "growth": 5.0, "cbd_km": 2.5},
    "Halswell":             {"median": 490_000, "yield": 4.6, "growth": 7.0, "cbd_km": 9.0},
    "Hillmorton":           {"median": 455_000, "yield": 4.9, "growth": 5.5, "cbd_km": 6.0},
    "Hoon Hay":             {"median": 480_000, "yield": 5.2, "growth": 6.0, "cbd_km": 5.5},
    "Hornby":               {"median": 470_000, "yield": 5.5, "growth": 11.0, "cbd_km": 10.0},
    "Ilam":                 {"median": 480_000, "yield": 5.0, "growth": 5.0, "cbd_km": 5.5},
    "Islington":            {"median": 420_000, "yield": 5.5, "growth": 7.0, "cbd_km": 11.0},
    "Linwood":              {"median": 440_000, "yield": 5.8, "growth": 4.0, "cbd_km": 3.0},
    "Mairehau":             {"median": 465_000, "yield": 5.0, "growth": 6.0, "cbd_km": 5.5},
    "Marshland":            {"median": 470_000, "yield": 4.9, "growth": 7.5, "cbd_km": 9.0},
    "Middleton":            {"median": 440_000, "yield": 5.1, "growth": 5.5, "cbd_km": 5.0},
    "New Brighton":         {"median": 450_000, "yield": 5.5, "growth": 9.0, "cbd_km": 8.0},
    "North New Brighton":   {"median": 430_000, "yield": 5.4, "growth": 8.5, "cbd_km": 8.5},
    "Northcote":            {"median": 470_000, "yield": 4.8, "growth": 5.5, "cbd_km": 6.0},
    "Opawa":                {"median": 470_000, "yield": 4.7, "growth": 5.0, "cbd_km": 4.0},
    "Papanui":              {"median": 490_000, "yield": 4.7, "growth": 5.0, "cbd_km": 5.0},
    "Parklands":            {"median": 470_000, "yield": 4.8, "growth": 7.0, "cbd_km": 9.0},
    "Phillipstown":         {"median": 430_000, "yield": 5.8, "growth": 3.0, "cbd_km": 2.0},
    "Redwood":              {"median": 460_000, "yield": 5.1, "growth": 6.5, "cbd_km": 7.0},
    "Riccarton":            {"median": 450_000, "yield": 5.4, "growth": 4.0, "cbd_km": 4.0},
    "Richmond":             {"median": 440_000, "yield": 5.1, "growth": 5.5, "cbd_km": 3.0},
    "Russley":              {"median": 480_000, "yield": 4.7, "growth": 5.5, "cbd_km": 8.5},
    "Saint Albans":         {"median": 465_000, "yield": 4.6, "growth": 5.0, "cbd_km": 3.0},
    "Saint Martins":        {"median": 480_000, "yield": 4.7, "growth": 5.0, "cbd_km": 4.5},
    "Shirley":              {"median": 470_000, "yield": 5.0, "growth": 5.0, "cbd_km": 5.0},
    "Sockburn":             {"median": 440_000, "yield": 5.0, "growth": 6.0, "cbd_km": 7.0},
    "Somerfield":           {"median": 475_000, "yield": 4.5, "growth": 4.5, "cbd_km": 4.0},
    "Spreydon":             {"median": 455_000, "yield": 5.0, "growth": 5.5, "cbd_km": 3.5},
    "Strowan":              {"median": 490_000, "yield": 4.4, "growth": 4.5, "cbd_km": 4.5},
    "Sydenham":             {"median": 455_000, "yield": 5.2, "growth": 4.5, "cbd_km": 2.5},
    "Wainoni":              {"median": 420_000, "yield": 5.7, "growth": 8.5, "cbd_km": 6.0},
    "Waltham":              {"median": 420_000, "yield": 5.7, "growth": 5.0, "cbd_km": 2.5},
    "Wigram":               {"median": 480_000, "yield": 4.7, "growth": 7.0, "cbd_km": 8.0},
    "Woolston":             {"median": 460_000, "yield": 5.6, "growth": 5.5, "cbd_km": 4.0},
    "Bromley":              {"median":   450_000, "yield": 5.6, "growth": 6.0, "cbd_km": 6.0},
    "Broomfield":           {"median":   540_000, "yield": 5.0, "growth": 6.5, "cbd_km": 12.0},
    "Bryndwr":              {"median":   680_000, "yield": 4.3, "growth": 5.0, "cbd_km": 5.0},
    "Burnside":             {"median":   720_000, "yield": 4.1, "growth": 5.0, "cbd_km": 6.5},
    "Cracroft":             {"median":   900_000, "yield": 3.6, "growth": 4.5, "cbd_km": 5.0},
    "Fendalton":            {"median": 1_150_000, "yield": 3.2, "growth": 4.0, "cbd_km": 4.0},
    "Heathcote Valley":     {"median":   700_000, "yield": 4.2, "growth": 5.0, "cbd_km": 7.0},
    "Hei Hei":              {"median":   480_000, "yield": 5.4, "growth": 6.5, "cbd_km": 11.0},
    "Huntsbury":            {"median":   850_000, "yield": 3.7, "growth": 4.5, "cbd_km": 4.5},
    "Redcliffs":            {"median":   820_000, "yield": 3.9, "growth": 5.5, "cbd_km": 9.0},
    "Upper Riccarton":      {"median":   620_000, "yield": 4.6, "growth": 4.5, "cbd_km": 5.5},
    "Yaldhurst":            {"median":   750_000, "yield": 4.2, "growth": 5.5, "cbd_km": 12.0},
}

CITY_MEDIAN = 455_000.0        # Christchurch sub-$500k segment reference median
CITY_GROWTH_PCT = 5.5          # long-run nominal growth anchor for mean reversion

FEATURES = [
    "intercept",
    "log_suburb_median",
    "bedrooms",
    "bathrooms",
    "log_land",
    "log_floor",
    "has_garage",
    "is_unit",
    "is_townhouse",
    "is_apartment",
    "is_section",
    "is_lifestyle",
]

# Documented priors, in log-price space (a coefficient of 0.06 ~= +6% per unit).
#
#   log_suburb_median  1.0  -> price scales one-for-one with location's median
#   bedrooms          0.055 -> each extra bedroom adds ~5.5%
#   bathrooms         0.040 -> each extra bathroom adds ~4%
#   log_land          0.050 -> land elasticity; doubling section ~ +3.5%
#   log_floor         0.150 -> floor-area elasticity, the strongest physical driver
#   has_garage        0.030 -> garage premium in a market where it is expected
#   is_unit          -0.080 | is_townhouse -0.100 | is_apartment -0.130  (vs house)
#
# Because the design matrix is centred (see design_row), the intercept simply *is*
# the log price of the reference property — a median-featured, garaged house in a
# median-priced suburb.
PRIORS: dict[str, float] = {
    "intercept": math.log(CITY_MEDIAN),
    "log_suburb_median": 1.00,
    "bedrooms": 0.055,
    "bathrooms": 0.040,
    "log_land": 0.050,
    "log_floor": 0.150,
    "has_garage": 0.030,
    "is_unit": -0.080,
    "is_townhouse": -0.100,
    "is_apartment": -0.130,
    # Bare land and lifestyle blocks are different markets from a suburban house; these
    # only matter because the scrape mixes them in (see scripts/clean_listings.py).
    "is_section": -0.450,
    "is_lifestyle": 0.200,
}

# Features held close to their documented prior whatever the sample says. Garage is
# only known where the detail harvest reached the listing, and the type dummies rest on
# a handful of rows each, so letting them float lets noise masquerade as signal.
STIFF_FEATURES = {"has_garage", "is_unit", "is_townhouse", "is_apartment", "is_section", "is_lifestyle"}
STIFF_LAMBDA = 25.0

# "Enquiries over $X" / "Negotiable from $X" quote a floor, not the expected price. The
# model learns how far above the floor such homes are valued and removes it when
# valuing, so a floor quote does not drag the whole suburb down.
FLOOR_PRICE_RE = re.compile(
    r"(enquir\w*|offers?|negotiable|buyer\s+enquiry)\s+(over|from|above)|\bfrom\s+\$", re.I
)
FLOOR_PRICE_PRIOR = 0.04

LAMBDA_GRID = [0.5, 1.0, 2.0, 5.0, 10.0, 25.0, 50.0, 100.0, 250.0, 1000.0]


# --------------------------------------------------------------------------- #
# Linear algebra (pure Python — the build must not need numpy)
# --------------------------------------------------------------------------- #
def solve(a: list[list[float]], b: list[float]) -> list[float] | None:
    """Solve a*x = b by Gaussian elimination with partial pivoting."""
    n = len(b)
    m = [row[:] + [b[i]] for i, row in enumerate(a)]
    for col in range(n):
        pivot = max(range(col, n), key=lambda r: abs(m[r][col]))
        if abs(m[pivot][col]) < 1e-12:
            return None  # singular
        m[col], m[pivot] = m[pivot], m[col]
        pv = m[col][col]
        for r in range(col + 1, n):
            factor = m[r][col] / pv
            if factor:
                for c in range(col, n + 1):
                    m[r][c] -= factor * m[col][c]
    x = [0.0] * n
    for row in range(n - 1, -1, -1):
        total = m[row][n] - sum(m[row][c] * x[c] for c in range(row + 1, n))
        x[row] = total / m[row][row]
    return x


def ridge_to_prior(
    xs: list[list[float]], ys: list[float], prior: list[float], lam: float
) -> list[float]:
    """Ridge regression that shrinks toward ``prior`` instead of toward zero.

    b = (X'X + lam*I)^-1 (X'y + lam*prior). Falls back to the prior if the system
    is singular (which happens when a feature is constant across the sample).
    """
    k = len(prior)
    xtx = [[0.0] * k for _ in range(k)]
    xty = [0.0] * k
    for row, y in zip(xs, ys):
        for i in range(k):
            xty[i] += row[i] * y
            for j in range(k):
                xtx[i][j] += row[i] * row[j]
    for i in range(k):
        xtx[i][i] += lam
        xty[i] += lam * prior[i]
    return solve(xtx, xty) or list(prior)


# --------------------------------------------------------------------------- #
# Feature extraction
# --------------------------------------------------------------------------- #
def suburb_median(
    suburb: str | None, location: dict | None = None, region: str | None = None
) -> float:
    """Reference value of a standard house in this suburb.

    With a trained ``location`` (from ``fit_location``) that is the value learned from
    this scrape: the suburb's own effect, else its district's, else the city's. Without
    one it is the legacy reference table, which is what an untrained build serves.
    """
    if location:
        subs = location.get("suburbs", {})
        if suburb and suburb in subs:
            return subs[suburb]
        dists = location.get("districts", {})
        if region and region in dists:
            return dists[region]
        return location.get("city", CITY_MEDIAN)
    return SUBURB_STATS.get(suburb or "", {}).get("median", CITY_MEDIAN)


def land_of(listing: dict) -> float | None:
    enr = listing.get("enrichment") or {}
    return enr.get("land_area_m2") or listing.get("land_area_m2")


def design_row(
    listing: dict, medians: dict[str, float], location: dict | None = None
) -> list[float]:
    """Build one feature row, **centred** on a reference property.

    Every continuous feature is expressed as a deviation from the reference — a
    median-featured house with a garage in a median-priced suburb. Centring is not
    cosmetic here, it is load-bearing:

    Un-centred, ``log_suburb_median`` is a raw value around 13. Its coefficient sits
    near 1.0, so a shrinkage-induced wobble of 0.006 moves the prediction by
    ``13 * 0.006 = 0.08`` in log space — an ~8% shift in every valuation from a
    change too small to notice in the coefficient table. It also breaks the intercept
    anchor, which is computed from the priors and no longer holds once the fitted
    coefficient moves.

    Centred, the intercept *is* log(reference price) by construction, so the
    reference property always prices at the reference regardless of what the other
    coefficients do, and each coefficient is a clean marginal effect. Ridge is also
    far better conditioned on features that straddle zero.

    Must stay in step with ``designRow`` in frontend/lib/predict.ts.
    """
    ptype = (listing.get("property_type") or "house").lower()
    land = land_of(listing) or medians["land"]
    floor = listing.get("floor_area_m2") or medians["floor"]
    return [
        1.0,
        math.log(suburb_median(listing.get("suburb"), location, listing.get("region")))
        - math.log(location.get("city", CITY_MEDIAN) if location else CITY_MEDIAN),
        float(listing.get("bedrooms") or medians["bedrooms"]) - medians["bedrooms"],
        float(listing.get("bathrooms") or medians["bathrooms"]) - medians["bathrooms"],
        math.log1p(float(land)) - math.log1p(medians["land"]),
        math.log1p(float(floor)) - math.log1p(medians["floor"]),
        # Reference has a garage, so this is the penalty for lacking one.
        (1.0 if listing.get("has_garage") else 0.0) - 1.0,
        1.0 if ptype == "unit" else 0.0,
        1.0 if ptype == "townhouse" else 0.0,
        1.0 if ptype == "apartment" else 0.0,
        1.0 if ptype == "section" else 0.0,
        1.0 if ptype == "lifestyle" else 0.0,
    ]


def observed_price(listing: dict) -> float | None:
    """The asking price only when the listing genuinely publishes one.

    Two classes of row are excluded, both for the same reason — their price was
    written by us, so training on it would only teach the model the formula that
    produced it:

      * **No published figure.** Most sub-$500k Christchurch stock sells by Deadline
        Sale or Auction and quotes no price; ``expand_listings.py`` fills ``price``
        from a suburb band.
      * **Sample records.** The ``SEED-*`` demo listings quote an "Asking Price" that
        was hand-authored to look plausible.

    Provenance (from ``scripts/provenance.py``) is authoritative when present; the
    regex is the fallback for corpora annotated by an older pipeline.
    """
    prov = listing.get("provenance") or {}
    if prov:
        if prov.get("price") != "observed" or prov.get("record") == "sample":
            return None
    else:
        if not re.search(r"\$\s*[\d,]{6,}", listing.get("price_text") or ""):
            return None
        if re.match(r"^SEED", str(listing.get("source_id") or ""), re.I):
            return None

    price = listing.get("price")
    if not isinstance(price, (int, float)) or price <= 50_000:
        return None
    return float(price)


def dataset_medians(listings: list[dict]) -> dict[str, float]:
    def med(vals: list[float], default: float) -> float:
        vals = sorted(v for v in vals if v)
        if not vals:
            return default
        mid = len(vals) // 2
        return vals[mid] if len(vals) % 2 else (vals[mid - 1] + vals[mid]) / 2

    return {
        "land": med([land_of(l) or 0 for l in listings], 550.0),
        "floor": med([l.get("floor_area_m2") or 0 for l in listings], 110.0),
        "bedrooms": med([l.get("bedrooms") or 0 for l in listings], 3.0),
        "bathrooms": med([l.get("bathrooms") or 0 for l in listings], 1.0),
    }


# --------------------------------------------------------------------------- #
# Fit + cross-validate
# --------------------------------------------------------------------------- #
def kfold_mae(
    xs: list[list[float]], ys: list[float], prior: list[float], lam: float, folds: int = 5
) -> float:
    """Mean absolute error in log space, k-fold. Lower is better."""
    n = len(ys)
    folds = min(folds, n)
    if folds < 2:
        return float("inf")
    errors: list[float] = []
    for f in range(folds):
        test_idx = set(range(f, n, folds))
        tr_x = [xs[i] for i in range(n) if i not in test_idx]
        tr_y = [ys[i] for i in range(n) if i not in test_idx]
        if len(tr_x) < 2:
            continue
        beta = ridge_to_prior(tr_x, tr_y, prior, lam)
        for i in sorted(test_idx):
            pred = sum(b * v for b, v in zip(beta, xs[i]))
            errors.append(abs(pred - ys[i]))
    return sum(errors) / len(errors) if errors else float("inf")


def confidence_band(n_train: int, cv_mae_log: float) -> tuple[str, float]:
    """Honest confidence label + the +/- fraction to show as a range.

    The band is driven by cross-validated error, floored by sample size so a model
    fitted on a handful of observations can never advertise a tight range.
    """
    floor = 0.18 if n_train < 15 else 0.12 if n_train < 40 else 0.08
    spread = max(floor, min(0.45, cv_mae_log * 1.6 if math.isfinite(cv_mae_log) else floor))
    if n_train >= 60 and spread <= 0.10:
        level = "high"
    elif n_train >= 25 and spread <= 0.16:
        level = "medium"
    else:
        level = "low"
    return level, round(spread, 4)


def train(listings: list[dict]) -> dict:
    medians = dataset_medians(listings)

    rows = [(design_row(l, medians), math.log(p))
            for l in listings if (p := observed_price(l)) is not None]

    # No anchoring needed: the design matrix is centred, so the intercept prior is
    # already log(reference price) and stays interpretable after fitting.
    prior = [PRIORS[f] for f in FEATURES]

    if len(rows) < 4:
        # Not enough observed prices to calibrate anything: serve the documented priors.
        level, spread = confidence_band(len(rows), float("inf"))
        return {
            "coefficients": dict(zip(FEATURES, prior)),
            "lambda": None,
            "n_train": len(rows),
            "cv_mae_log": None,
            "cv_mae_pct": None,
            "r2": None,
            "confidence": level,
            "band": spread,
            "fitted": False,
        }

    xs = [r[0] for r in rows]
    ys = [r[1] for r in rows]

    best_lam, best_mae = None, float("inf")
    for lam in LAMBDA_GRID:
        mae = kfold_mae(xs, ys, prior, lam)
        if mae < best_mae:
            best_lam, best_mae = lam, mae

    beta = ridge_to_prior(xs, ys, prior, best_lam or 10.0)

    mean_y = sum(ys) / len(ys)
    ss_tot = sum((y - mean_y) ** 2 for y in ys)
    ss_res = sum((y - sum(b * v for b, v in zip(beta, x))) ** 2 for x, y in zip(xs, ys))
    r2 = 1 - ss_res / ss_tot if ss_tot > 1e-12 else None

    level, spread = confidence_band(len(rows), best_mae)
    return {
        "coefficients": dict(zip(FEATURES, beta)),
        "lambda": best_lam,
        "n_train": len(rows),
        "cv_mae_log": round(best_mae, 4),
        # In log space a MAE of 0.08 is ~8% typical error; expm1 makes that explicit.
        "cv_mae_pct": round(math.expm1(best_mae) * 100, 1),
        "r2": round(r2, 4) if r2 is not None else None,
        "confidence": level,
        "band": spread,
        "fitted": True,
    }


# Modelled figures are rounded to this, because quoting an estimate to the dollar
# ("$488,287") implies a precision the model does not have — its band is +/-16%.
# --------------------------------------------------------------------------- #
# Learned location (v2)
# --------------------------------------------------------------------------- #
#
# v1 priced location off a hand-kept table of "sub-$500k segment" suburb medians. In
# the Nov 2026 scrape 63% of listings sat in suburbs that table never covered (Rangiora,
# Rolleston, Kaiapoi, Lincoln...), so they were all valued as an average Christchurch
# home — the single largest source of error (cross-validated median miss 18%).
#
# v2 learns location from the asking prices themselves, hierarchically:
#
#     log(price) = city + district effect + suburb effect + physical features
#
# fitted by backfitting. Each district/suburb effect is an empirical-Bayes mean of
# what is left after the physical features, shrunk toward its parent by a pseudo-count
# (k): a suburb with two sales moves only part-way from its district, one with thirty
# moves nearly all the way. The physical coefficients stay ridge-shrunk toward the
# documented PRIORS. k and lambda are chosen by repeated, shuffled 5-fold CV.

MIN_LOCATION_ROWS = 30
LOCATION_GRID = [(lam, k) for lam in (1.0, 2.0, 5.0) for k in (2.0, 4.0, 8.0)]
K_DISTRICT = 3.0
LEGACY_TABLE_WEIGHT = 0.5  # how far an unseen legacy suburb sits from its district
BACKFIT_ITERS = 8
CV_SEEDS = 5


def is_floor_price(listing: dict) -> bool:
    return bool(FLOOR_PRICE_RE.search(listing.get("price_text") or ""))


def _phys(row: list[float]) -> list[float]:
    return row[2:]  # drop intercept + location


PHYS_FEATURES = FEATURES[2:]


def fit_location(rows: list[dict], lam: float, k_sub: float, k_dist: float = K_DISTRICT) -> dict:
    """Backfit physical coefficients + floor premium + district/suburb effects.

    ``rows``: dicts with ``x`` (physical features), ``y`` (log asking), ``d`` (district),
    ``s`` (suburb), ``f`` (1 if the price is a floor quote).
    """
    names = PHYS_FEATURES + ["floor_price"]
    prior = [PRIORS[f] for f in PHYS_FEATURES] + [FLOOR_PRICE_PRIOR]
    lams = [STIFF_LAMBDA if f in STIFF_FEATURES else lam for f in PHYS_FEATURES] + [lam]
    xs = [r["x"] + [r["f"]] for r in rows]
    ys = [r["y"] for r in rows]
    beta = list(prior)
    mu, de, se = sum(ys) / len(ys), {}, {}
    n, k = len(rows), len(names)
    for _ in range(BACKFIT_ITERS):
        resid = [ys[i] - sum(b * v for b, v in zip(beta, xs[i])) for i in range(n)]
        mu = sum(resid) / n
        groups: dict[str, list[int]] = {}
        for i, r in enumerate(rows):
            groups.setdefault(r["d"], []).append(i)
        de = {d: sum(resid[i] - mu for i in idx) / (len(idx) + k_dist) for d, idx in groups.items()}
        groups = {}
        for i, r in enumerate(rows):
            groups.setdefault(r["s"], []).append(i)
        se = {
            s: sum(resid[i] - mu - de[rows[i]["d"]] for i in idx) / (len(idx) + k_sub)
            for s, idx in groups.items()
        }
        offset = [mu + de[r["d"]] + se[r["s"]] for r in rows]
        xtx = [[0.0] * k for _ in range(k)]
        xty = [0.0] * k
        for i in range(n):
            t = ys[i] - offset[i]
            for a in range(k):
                xty[a] += xs[i][a] * t
                for c in range(k):
                    xtx[a][c] += xs[i][a] * xs[i][c]
        for a in range(k):
            xtx[a][a] += lams[a]
            xty[a] += lams[a] * prior[a]
        beta = solve(xtx, xty) or beta
    counts: dict[str, int] = {}
    for r in rows:
        counts[r["s"]] = counts.get(r["s"], 0) + 1
    return {
        "mu": mu,
        "districts": de,
        "suburbs": se,
        "beta": dict(zip(PHYS_FEATURES, beta[:-1])),
        "floor_premium": beta[-1],
        "suburb_n": counts,
    }


def _predict_log(fit: dict, r: dict, asking: bool) -> float:
    d = fit["districts"].get(r["d"], 0.0)
    s = fit["suburbs"].get(r["s"], 0.0)
    phys = sum(fit["beta"][f] * v for f, v in zip(PHYS_FEATURES, r["x"]))
    return fit["mu"] + d + s + phys + (fit["floor_premium"] * r["f"] if asking else 0.0)


def _folds(n: int, seed: int, k: int = 5) -> list[set[int]]:
    import random

    idx = list(range(n))
    random.Random(seed).shuffle(idx)
    return [set(idx[f::k]) for f in range(k)]


def cv_errors(rows: list[dict], lam: float, k_sub: float, seeds: int = CV_SEEDS) -> list[float]:
    """Out-of-fold log errors against the published figure, over repeated shuffles."""
    errs: list[float] = []
    for seed in range(seeds):
        for test in _folds(len(rows), seed):
            train_rows = [r for i, r in enumerate(rows) if i not in test]
            if len(train_rows) < 4:
                continue
            fit = fit_location(train_rows, lam, k_sub)
            errs += [_predict_log(fit, rows[i], asking=True) - rows[i]["y"] for i in sorted(test)]
    return errs


def legacy_cv_errors(xs: list[list[float]], ys: list[float], seeds: int = CV_SEEDS) -> list[float]:
    """The v1 model's out-of-fold errors on the same shuffles, for an honest comparison."""
    prior = [PRIORS[f] for f in FEATURES]
    errs: list[float] = []
    for seed in range(seeds):
        for test in _folds(len(ys), seed):
            tx = [xs[i] for i in range(len(ys)) if i not in test]
            ty = [ys[i] for i in range(len(ys)) if i not in test]
            if len(tx) < 4:
                continue
            lam = min(LAMBDA_GRID, key=lambda l: kfold_mae(tx, ty, prior, l))
            beta = ridge_to_prior(tx, ty, prior, lam)
            errs += [sum(b * v for b, v in zip(beta, xs[i])) - ys[i] for i in sorted(test)]
    return errs


def error_summary(errs: list[float]) -> dict:
    if not errs:
        return {}
    ape = sorted(abs(math.expm1(e)) for e in errs)
    mae = sum(abs(e) for e in errs) / len(errs)
    return {
        "mae_log": round(mae, 4),
        "mae_pct": round(math.expm1(mae) * 100, 1),
        "median_ape_pct": round(ape[len(ape) // 2] * 100, 1),
        "within_10_pct": round(sum(a <= 0.10 for a in ape) / len(ape) * 100),
        "within_20_pct": round(sum(a <= 0.20 for a in ape) / len(ape) * 100),
    }


def location_table(fit: dict, all_listings: list[dict]) -> dict:
    """Dollar values of a reference house by suburb/district, for model.json."""
    city = math.exp(fit["mu"])
    districts = {d: math.exp(fit["mu"] + e) for d, e in fit["districts"].items()}
    suburb_region: dict[str, str] = {}
    for l in all_listings:
        if l.get("suburb") and l.get("region"):
            suburb_region.setdefault(l["suburb"], l["region"])
    suburbs: dict[str, float] = {}
    ccc = fit["districts"].get("christchurch-city", 0.0)
    for name, stat in SUBURB_STATS.items():
        rel = math.log(stat["median"]) - math.log(CITY_MEDIAN)
        suburbs[name] = math.exp(fit["mu"] + ccc + LEGACY_TABLE_WEIGHT * rel)
    for name, region in suburb_region.items():
        base = fit["mu"] + fit["districts"].get(region, 0.0)
        suburbs[name] = math.exp(base + fit["suburbs"].get(name, 0.0)) if name in fit["suburbs"] else suburbs.get(name, math.exp(base))
    for name, e in fit["suburbs"].items():
        if name not in suburbs:
            suburbs[name] = math.exp(fit["mu"] + e)
    return {"city": city, "districts": districts, "suburbs": suburbs}


def train_v2(listings: list[dict], medians: dict[str, float]) -> dict | None:
    rows, legacy_x = [], []
    for l in listings:
        p = observed_price(l)
        if p is None:
            continue
        x = design_row(l, medians)
        rows.append({
            "x": _phys(x), "y": math.log(p), "f": 1.0 if is_floor_price(l) else 0.0,
            "d": l.get("region") or "unknown", "s": l.get("suburb") or "unknown",
        })
        legacy_x.append(x)
    if len(rows) < MIN_LOCATION_ROWS:
        return None

    scored = []
    for lam, k_sub in LOCATION_GRID:
        errs = cv_errors(rows, lam, k_sub)
        scored.append((sum(abs(e) for e in errs) / len(errs), lam, k_sub, errs))
    best_mae, lam, k_sub, best_errs = min(scored, key=lambda t: t[0])

    fit = fit_location(rows, lam, k_sub)
    loc = location_table(fit, listings)
    coefficients = {"intercept": math.log(loc["city"]), "log_suburb_median": 1.0, **fit["beta"]}

    ys = [r["y"] for r in rows]
    mean_y = sum(ys) / len(ys)
    ss_tot = sum((y - mean_y) ** 2 for y in ys)
    ss_res = sum((_predict_log(fit, r, asking=True) - r["y"]) ** 2 for r in rows)
    cv_ss = sum(e * e for e in best_errs) / len(best_errs) * len(ys)

    level, spread = confidence_band(len(rows), best_mae)
    return {
        "coefficients": coefficients,
        "lambda": lam,
        "k_suburb": k_sub,
        "n_train": len(rows),
        "cv_mae_log": round(best_mae, 4),
        "cv_mae_pct": round(math.expm1(best_mae) * 100, 1),
        "r2": round(1 - ss_res / ss_tot, 4) if ss_tot > 1e-12 else None,
        "cv_r2": round(1 - cv_ss / ss_tot, 4) if ss_tot > 1e-12 else None,
        "confidence": level,
        "band": spread,
        "fitted": True,
        "floor_price_premium": round(fit["floor_premium"], 4),
        "accuracy": error_summary(best_errs),
        "baseline_accuracy": error_summary(legacy_cv_errors(legacy_x, ys)),
        "location": loc,
        "suburb_n": fit["suburb_n"],
    }


ESTIMATE_ROUNDING = 1_000


def predict_value(
    listing: dict,
    coefficients: dict[str, float],
    medians: dict[str, float],
    location: dict | None = None,
) -> float:
    """Modelled market value for one listing, in dollars (unrounded)."""
    row = design_row(listing, medians, location)
    log_price = sum(coefficients[f] * v for f, v in zip(FEATURES, row))
    return math.exp(log_price)


def round_estimate(value: float) -> int:
    """Round a modelled value so it reads as an estimate rather than a valuation."""
    return int(round(value / ESTIMATE_ROUNDING) * ESTIMATE_ROUNDING)


def write_price_estimates(
    listings: list[dict],
    coefficients: dict[str, float],
    medians: dict[str, float],
    location: dict | None = None,
) -> int:
    """Attach ``price_estimate`` to every listing, in place.

    Most Christchurch listings publish no asking price, so something has to fill the
    gap or the app has no figure to run mortgage maths against. That number now comes
    from the valuation model — which is documented, cross-validated and carries a
    confidence band — rather than from an ad-hoc suburb-band formula in a build
    script, which is what ``expand_listings.py`` used to do.

    ``price`` itself is left untouched: null stays null. The UI shows the published
    price where one exists and this estimate otherwise, labelled as an estimate.
    """
    for listing in listings:
        listing["price_estimate"] = round_estimate(
            predict_value(listing, coefficients, medians, location)
        )
    return sum(1 for l in listings if not l.get("price"))


DISTRICT_LABELS = {
    "christchurch-city": "Christchurch City",
    "selwyn": "Selwyn",
    "waimakariri": "Waimakariri",
}
# Rent and growth for suburbs the legacy table never covered: the district's typical
# figures. Indicative, like the table itself.
DISTRICT_DEFAULTS = {
    "christchurch-city": {"yield": 4.8, "growth": 5.0, "cbd_km": 6.0},
    "selwyn": {"yield": 4.3, "growth": 5.5, "cbd_km": 22.0},
    "waimakariri": {"yield": 4.4, "growth": 5.0, "cbd_km": 25.0},
}


def suburb_payload(location: dict | None, listings: list[dict]) -> dict:
    """Per-suburb stats for the browser: learned value + indicative yield/growth."""
    if not location:
        return SUBURB_STATS
    region_of = {l["suburb"]: l.get("region") for l in listings if l.get("suburb")}
    out = {}
    for name, value in location["suburbs"].items():
        legacy = SUBURB_STATS.get(name)
        fallback = DISTRICT_DEFAULTS.get(region_of.get(name) or "christchurch-city", DISTRICT_DEFAULTS["christchurch-city"])
        out[name] = {
            "median": round(value, -3),
            "yield": (legacy or fallback)["yield"],
            "growth": (legacy or fallback)["growth"],
            "cbd_km": (legacy or fallback)["cbd_km"],
        }
    return out


def market_intel(model: dict, medians: dict[str, float]) -> dict:
    """Plain-language findings derived from the fitted model, shown on the homepage."""
    loc = model.get("location")
    if not loc:
        return {}
    c = model["coefficients"]
    ref = loc["city"]

    def dollars(log_delta: float) -> int:
        return int(round(ref * math.expm1(log_delta), -3))

    floor_step = math.log1p(medians["floor"] + 20) - math.log1p(medians["floor"])
    land_step = math.log1p(medians["land"] + 100) - math.log1p(medians["land"])
    effects = [
        {"label": "An extra bedroom", "dollars": dollars(c["bedrooms"])},
        {"label": "An extra bathroom", "dollars": dollars(c["bathrooms"])},
        {"label": "20 m² more floor area", "dollars": dollars(c["log_floor"] * floor_step)},
        {"label": "100 m² more land", "dollars": dollars(c["log_land"] * land_step)},
        {"label": "A garage", "dollars": dollars(c["has_garage"])},
        {"label": "Townhouse instead of a house", "dollars": dollars(c["is_townhouse"])},
    ]
    n = model.get("suburb_n", {})
    ladder = sorted(
        (
            {"suburb": s, "value": int(round(v, -3)), "n": n[s]}
            for s, v in loc["suburbs"].items()
            if n.get(s, 0) >= 3 and s not in DISTRICT_LABELS.values()
        ),
        key=lambda r: r["value"],
    )
    return {
        "reference": {
            "value": int(round(ref, -3)),
            "bedrooms": medians["bedrooms"],
            "bathrooms": medians["bathrooms"],
            "floor_m2": medians["floor"],
            "land_m2": medians["land"],
        },
        "districts": sorted(
            (
                {"district": DISTRICT_LABELS.get(d, d), "value": int(round(v, -3))}
                for d, v in loc["districts"].items()
            ),
            key=lambda r: r["value"],
        ),
        "effects": effects,
        "ladder": ladder,
        "floor_quote_premium_pct": round(math.expm1(model.get("floor_price_premium", 0)) * 100, 1),
    }


def main() -> None:
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    listings: list[dict] = []
    if LISTINGS_JSON.exists():
        try:
            data = json.loads(LISTINGS_JSON.read_text())
            listings = data if isinstance(data, list) else []
        except json.JSONDecodeError:
            listings = []

    print("=== HouseScout valuation model ===")
    medians = dataset_medians(listings)
    model = train_v2(listings, medians) or train(listings)
    location = model.get("location")

    payload = {
        "version": 2 if location else 1,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "features": FEATURES,
        "priors": PRIORS,
        "medians": medians,
        "city": {"median": round(location["city"]) if location else CITY_MEDIAN, "growth_pct": CITY_GROWTH_PCT},
        "suburbs": suburb_payload(location, listings),
        "districts": (
            {
                d: {"median": round(v, -3), **DISTRICT_DEFAULTS.get(d, DISTRICT_DEFAULTS["christchurch-city"])}
                for d, v in location["districts"].items()
            }
            if location
            else {}
        ),
        "intel": market_intel(model, medians),
        **{k: v for k, v in model.items() if k not in ("location", "suburb_n")},
    }
    OUT_JSON.write_text(json.dumps(payload, indent=2) + "\n")

    if listings:
        unpriced = write_price_estimates(listings, model["coefficients"], medians, location)
        LISTINGS_JSON.write_text(json.dumps(listings, indent=2) + "\n")
        print(f"  price estimates     : {len(listings)} written ({unpriced} with no published price)")

    print(f"  observed-price rows : {model['n_train']} of {len(listings)} listings")
    print(f"  lambda (CV-chosen)  : {model['lambda']}" + (f", suburb k {model['k_suburb']}" if location else ""))
    print(f"  cross-val MAE       : {model['cv_mae_pct']}%" if model["cv_mae_pct"] else "  cross-val MAE       : n/a")
    if location:
        a, b = model["accuracy"], model["baseline_accuracy"]
        print(f"  median miss         : {a['median_ape_pct']}% (v1 on the same cleaned data: {b['median_ape_pct']}%)")
        print(f"  within 10% / 20%    : {a['within_10_pct']}% / {a['within_20_pct']}% (v1: {b['within_10_pct']}% / {b['within_20_pct']}%)")
        print(f"  cross-val R^2       : {model['cv_r2']}")
    print(f"  in-sample R^2       : {model['r2']}")
    print(f"  confidence          : {model['confidence']} (+/-{model['band'] * 100:.0f}% band)")
    print(f"  wrote {OUT_JSON.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
