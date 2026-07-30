# Data sources & roadmap

## Listing sources (scraped — personal use, throttled, ToS-aware)
| Source | What it gives | Notes |
|---|---|---|
| realestate.co.nz | For-sale listings (price, beds, baths, land, type, photos) | **Primary source.** Plain-HTTP scraper (`scraper/api_scrapers.py`), newest-first, no browser needed; ~100 listings/run. Also a Playwright path (`scraper/realestate.py`) for richer data when it gets through. |
| homes.co.nz | Estimate, RV, rental estimate, last sale | Implemented as address enrichment (`scraper/homes.py`); enable with `--estimates`. |
| OneRoof | Estimate, RV, sold prices | Implemented as enrichment/fallback (`scraper/oneroof.py`). |
| Trade Me | Largest pool of listings | API **denies** buyer-side use → scrape or skip. |

> Trade Me's API explicitly will not be granted for "personal or non-commercial use (including
> price monitoring or buyer-side tools)", so it is not a reliable path for this project.

## Official / free data
| Source | What it gives | Status |
|---|---|---|
| **LINZ Data Service** | Parcels, titles, addresses, **land area (m²)** | Implemented (`scraper/linz.py`); free CC-BY key required. Powers the backyard filter. |
| interest.co.nz | Bank-by-bank current rates | Implemented (`scraper/rates.py`); live refresh via `POST /api/rates/refresh` or `python -m scraper.run --rates-only`. |
| RBNZ B20 | Official mortgage rate series | Optional official cross-check; wire later. |
| Stats NZ / data.govt.nz | Suburb demographics, growth | For richer suburb analytics. |
| Christchurch City Council | Rating valuations, hazard info | Enrichment + hazard flags. |

## NZ financial rules encoded
- **IRD boarder standard-cost method:** up to **$245/week per boarder (2025-26)** is effectively
  tax-free, **max 4 boarders**. See `backend/app/finance.py` (`BOARDER_TAX_FREE_WEEKLY`, `MAX_BOARDERS`).
  Update the constant each tax year.

## Data provenance (important)

Not every number on a listing comes from the listing. `scripts/provenance.py` labels
each one, and the UI shows the label:

| Flag | Meaning |
|---|---|
| `price: observed` | The source listing quotes this asking price. |
| `price: modelled` | The listing publishes **no** price (auction / deadline sale / by negotiation / POA). The figure shown is HouseScout's estimate from suburb comparables. |
| `record: sample` | A hand-written demonstration listing (`SEED-*` ids), shown only so the app stays usable when every scraper is blocked. |
| `coordinates: suburb_centroid` | The map pin is placed within the suburb, not geocoded to the section. |
| `rateable_value` / `estimate_value` / `rental_estimate_weekly`: `modelled` | Derived from `price`, not sourced. |

On a typical build roughly **85% of listings publish no price** — most Christchurch
stock under $500k sells by auction or deadline sale. Two consequences follow, and both
are deliberate:

1. **The valuation model trains only on `price: observed` rows.** Training on prices we
   inferred would teach the model the formula that produced them.
2. **The UI never presents a modelled price as an asking price**, and does not report a
   "gap to modelled value" when there is no published price to compare — comparing our
   estimate to our valuation would produce a bargain signal on nearly every listing.

## Valuation model

`scripts/hedonic.py` trains a log-linear hedonic price model at build time and writes
`frontend/public/model.json`; `frontend/lib/predict.ts` evaluates it in the browser.

- **Form:** `log(price)` on centred features — suburb median, bedrooms, bathrooms, land
  area, floor area, garage, property type.
- **Fitting:** ridge regression that shrinks toward documented NZ valuation priors
  rather than toward zero, with λ chosen by k-fold cross-validation. With few observed
  prices the priors dominate; as real asking prices accumulate the data takes over.
- **Honesty metadata:** the model carries `n_train`, cross-validated MAE, R² and a
  `confidence` band, all surfaced in the UI. Confidence is currently **low** and says so.
- **Derived outputs:** price position, per-room and whole-house rent, a mean-reverting
  capital-growth forecast with a widening band, negotiation room, and a composite deal
  score.

No language model is involved anywhere in the analysis path.

## Roadmap (post-v1)
1. **Grow the observed-price sample.** The single highest-leverage improvement: model
   confidence is capped by how few listings publish a price. Sold-price history
   (OneRoof/homes.co.nz) would supply real transaction prices to train on.
2. **Server-side entitlement** before charging: checkout, webhook, and serving the paid
   analysis from an authenticated endpoint instead of the public JSON. See the header of
   `frontend/lib/subscription.ts`.
3. Saved searches with email/push alerts on new high-score listings.
4. Multi-user: add auth + swap SQLite→Postgres (schema already `user_id`-aware).
5. Comparable-sales analysis to replace suburb medians with true comparables.
6. LINZ Basemaps style on the map (NZ aerial/topographic) with a key.
7. Natural-hazard overlays (flood/liquefaction) from council/LINZ data — material in
   Christchurch and currently absent.
8. Per-user buyer criteria (editable in the app rather than in `lib/data.ts`).

### Delivered
- **Automatic listing refresh** (`scraper/api_scrapers.py`, wired into
  `scripts/build_listings.py`): plain-HTTP fetch of current listings, newest-first. Previously
  dead code whose parser matched markup the site no longer serves, so the 6-hourly cron
  re-emitted hardcoded seed data. Now pinned by tests.
- **Photo pipeline** (`scripts/photos.py`): recovers real house photos over plain HTTP
  from listing detail pages and self-hosts them, with Pillow verification to drop
  headshots, logos and thumbnails. ~85% coverage; the rest render generated artwork.
- **Valuation model** (`scripts/hedonic.py` + `frontend/lib/predict.ts`) with fair
  value, price position, rent, growth forecast, negotiation room and deal score.
- **Data-provenance annotation** (`scripts/provenance.py`) surfaced throughout the UI.
- **Subscription tiers** with feature gating, Deal Radar, watchlist/compare, CSV export
  and printable reports.
- **LM Studio removed.** All analysis is deterministic and in-process
  (`backend/app/analysis.py`), shared by the backend and the static build.
- homes.co.nz + OneRoof estimate/RV/rental enrichment (`--estimates`).
- Live mortgage-rate scrape from interest.co.nz.
- MapLibre map view on the listings explorer (free OSM basemap).
