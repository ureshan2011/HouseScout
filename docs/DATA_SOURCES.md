# Data sources & roadmap

## Listing sources (scraped — personal use, throttled, ToS-aware)
| Source | What it gives | Notes |
|---|---|---|
| realestate.co.nz | For-sale listings (price, beds, baths, land, photos) | Implemented (`scraper/realestate.py`). Selectors isolated for easy fixes. |
| homes.co.nz | Estimates, sales history, RV, rental estimate | Planned next scraper; great for enrichment. |
| OneRoof | Estimates, sold prices, RV | Planned. |
| Trade Me | Largest pool of listings | API **denies** buyer-side use → scrape or skip. |

> Trade Me's API explicitly will not be granted for "personal or non-commercial use (including
> price monitoring or buyer-side tools)", so it is not a reliable path for this project.

## Official / free data
| Source | What it gives | Status |
|---|---|---|
| **LINZ Data Service** | Parcels, titles, addresses, **land area (m²)** | Implemented (`scraper/linz.py`); free CC-BY key required. Powers the backyard filter. |
| RBNZ B20 | Official mortgage rate series | Seeded indicatively; wire live later. |
| interest.co.nz | Bank-by-bank current rates | Scrape into `mortgage_rates` later. |
| Stats NZ / data.govt.nz | Suburb demographics, growth | For richer suburb analytics. |
| Christchurch City Council | Rating valuations, hazard info | Enrichment + hazard flags. |

## NZ financial rules encoded
- **IRD boarder standard-cost method:** up to **$245/week per boarder (2025-26)** is effectively
  tax-free, **max 4 boarders**. See `backend/app/finance.py` (`BOARDER_TAX_FREE_WEEKLY`, `MAX_BOARDERS`).
  Update the constant each tax year.

## Roadmap (post-v1)
1. homes.co.nz + OneRoof scrapers → fill estimate/RV/rental-estimate enrichment automatically.
2. Live mortgage-rate scrape (interest.co.nz) replacing seeded rates.
3. Embedding-backed RAG (sqlite-vec) once an embedding model is loaded in LM Studio.
4. Map view (MapLibre + LINZ basemap) on the listings explorer.
5. Saved searches, email/push alerts on new high-score listings.
6. Multi-user: add auth + swap SQLite→Postgres (schema already `user_id`-aware).
7. Comparable-sales analysis and a "what to offer" estimator.
