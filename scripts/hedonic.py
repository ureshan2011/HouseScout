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
}

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
def suburb_median(suburb: str | None) -> float:
    return SUBURB_STATS.get(suburb or "", {}).get("median", CITY_MEDIAN)


def land_of(listing: dict) -> float | None:
    enr = listing.get("enrichment") or {}
    return enr.get("land_area_m2") or listing.get("land_area_m2")


def design_row(listing: dict, medians: dict[str, float]) -> list[float]:
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
        math.log(suburb_median(listing.get("suburb"))) - math.log(CITY_MEDIAN),
        float(listing.get("bedrooms") or medians["bedrooms"]) - medians["bedrooms"],
        float(listing.get("bathrooms") or medians["bathrooms"]) - medians["bathrooms"],
        math.log1p(float(land)) - math.log1p(medians["land"]),
        math.log1p(float(floor)) - math.log1p(medians["floor"]),
        # Reference has a garage, so this is the penalty for lacking one.
        (1.0 if listing.get("has_garage") else 0.0) - 1.0,
        1.0 if ptype == "unit" else 0.0,
        1.0 if ptype == "townhouse" else 0.0,
        1.0 if ptype == "apartment" else 0.0,
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
    model = train(listings)
    medians = dataset_medians(listings)

    payload = {
        "version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "features": FEATURES,
        "priors": PRIORS,
        "medians": medians,
        "city": {"median": CITY_MEDIAN, "growth_pct": CITY_GROWTH_PCT},
        "suburbs": SUBURB_STATS,
        **model,
    }
    OUT_JSON.write_text(json.dumps(payload, indent=2) + "\n")

    print(f"  observed-price rows : {model['n_train']} of {len(listings)} listings")
    print(f"  lambda (CV-chosen)  : {model['lambda']}")
    print(f"  cross-val MAE       : {model['cv_mae_pct']}%" if model["cv_mae_pct"] else "  cross-val MAE       : n/a")
    print(f"  in-sample R^2       : {model['r2']}")
    print(f"  confidence          : {model['confidence']} (+/-{model['band'] * 100:.0f}% band)")
    print(f"  wrote {OUT_JSON.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
