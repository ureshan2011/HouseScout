# Data sources & roadmap

## Listing sources (scraped — personal use, throttled, ToS-aware)
| Source | What it gives | Notes |
|---|---|---|
| realestate.co.nz | For-sale listings (price, beds, baths, land, photos) | Implemented (`scraper/realestate.py`). Selectors isolated for easy fixes. |
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

## Roadmap (post-v1)
1. Saved searches, email/push alerts on new high-score listings.
2. Multi-user: add auth + swap SQLite→Postgres (schema already `user_id`-aware).
3. Comparable-sales analysis and a "what to offer" estimator.
4. LINZ Basemaps style on the map (NZ aerial/topographic) with a key.
5. Natural-hazard overlays (flood/liquefaction) from council/LINZ data.

### Delivered
- homes.co.nz + OneRoof estimate/RV/rental enrichment (`--estimates`).
- Live mortgage-rate scrape from interest.co.nz.
- Embedding-backed RAG chat (numpy cosine over LM Studio embeddings) with
  score-ordered fallback.
- MapLibre map view on the listings explorer (free OSM basemap).
