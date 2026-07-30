# 🏠 HouseScout — Christchurch House-Buying Intelligence

A platform to find, analyse and finance a first home in **Christchurch, NZ**, built around one
strategy: **buy under $500k with a garage + backyard, live in it, rent the spare rooms to boarders,
and pay the mortgage off as fast as possible.**

It scrapes listings, self-hosts their photos, enriches them with free official **LINZ** land data,
ranks them against your criteria, runs full **mortgage + boarder-income + accelerated-payoff**
analysis, and puts a **valuation model** on top — fair value, over/under-priced, predicted rent,
capital-growth forecast and negotiation room.

**Everything runs in-process.** No model server, no API keys, no per-query cost: the valuation model
is trained at build time and evaluated in your browser, and the written analysis is generated from
each listing's own numbers. It works offline, costs nothing to run, and every figure traces back to a
coefficient or a listing field you can inspect.

> Property estimates are indicative, not registered valuations.
> Land data © LINZ (CC-BY 4.0). Not financial advice.

## ⚠️ Read this before trusting a price

Most Christchurch stock under $500k sells by **auction or deadline sale and publishes no price at
all**. For those listings the price you see is **HouseScout's own estimate**, labelled `Est. price`
in the UI. Roughly 85% of a typical build falls into this category.

The app is built around that constraint rather than hiding it:

- every listing carries machine-readable provenance (`scripts/provenance.py`);
- the valuation model trains **only** on genuinely published asking prices;
- no "gap to modelled value" is shown when there is no published price to compare against;
- model confidence is reported honestly, and is currently **low**.

See [`docs/DATA_SOURCES.md`](docs/DATA_SOURCES.md#data-provenance-important) for the full picture.

## Architecture

```
backend/    FastAPI · SQLAlchemy · SQLite · APScheduler   (API, scoring, finance, analysis)
scraper/    Playwright scrapers + LINZ enrichment          (run by CLI or the scheduler)
scripts/    Build pipeline: scrape → photos → provenance → model → analysis
frontend/   Next.js 15 · TypeScript · Tailwind · Recharts  (the app)
data/       SQLite db + image cache (gitignored)
```

The finance and scoring engines are **pure functions** (`backend/app/finance.py`,
`backend/app/scoring.py`) with unit tests — the trustworthy core of the app. They are
mirrored 1:1 in TypeScript (`frontend/lib/finance.ts`, `frontend/lib/scoring.ts`) so the
app can also run **fully static**, with no backend at all.

Key modules added since v1:

| Module | Does |
|---|---|
| `scripts/photos.py` | Recovers real house photos over plain HTTP and self-hosts them. |
| `scripts/provenance.py` | Labels where every number came from (observed / modelled / sample). |
| `scripts/hedonic.py` | Trains the valuation model → `frontend/public/model.json`. |
| `frontend/lib/predict.ts` | Evaluates the model in the browser: value, rent, growth, negotiation, deal score. |
| `backend/app/analysis.py` | Deterministic written analysis + Q&A, shared by the backend and the static build. |
| `frontend/lib/subscription.ts` | Tiers and feature entitlements. |

## Two ways to run it

| Mode | What runs | Data | Analysis |
|------|-----------|------|----------|
| **Static web app** (GitHub Pages) | Just the frontend, entirely in the browser | Christchurch listings scraped at build time (keyless, parallel), photos self-hosted, scored in the browser | In-browser: valuation model + baked written analysis |
| **Full stack** (local/24-7) | FastAPI + SQLite + scheduler + Playwright scraper | Live scraped + LINZ-enriched listings in a database | In-process (`backend/app/analysis.py`) |

Both modes use the same deterministic engines — there is nothing external to install or
configure. The static build scrapes listings and harvests photos automatically when GitHub
Actions builds the site, and refreshes every 6 hours — no API keys. Run the Python backend when
you want LINZ land data and a persistent database.

## Deploy to GitHub Pages (static web app)

The repo ships a workflow (`.github/workflows/deploy.yml`) that builds the Next.js static
export and publishes it to Pages on every push to `main`.

1. In the repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Push to `main` (or run the workflow manually). The site goes live at
   `https://<user>.github.io/<repo>/`.

The workflow sets `NEXT_PUBLIC_BASE_PATH=/<repo>` automatically so assets and links resolve
under the project sub-path. To build it yourself:

```bash
cd frontend && npm ci && cd ..
pip install playwright pillow && python -m playwright install chromium firefox
python scripts/scrape_listings.py            # all sources -> frontend/public/listings.json (+ photos)
cd frontend && NEXT_PUBLIC_BASE_PATH=/<repo> npm run build   # static site in frontend/out/
```

For a user/org root site (`https://<user>.github.io/`) or a custom domain, leave
`NEXT_PUBLIC_BASE_PATH` unset.

### Live listings — fetched automatically every 6 hours (no keys)

`scraper/api_scrapers.py` fetches current listings over **plain HTTP**, sorted newest-first
(`?by=latest`), paginating until it runs out. This is the runner that keeps the dataset fresh,
and it needs no browser: search pages are reachable without one.

> **This was previously dead code.** The scrapers existed but nothing imported them, and their
> HTML parser targeted markup the site no longer serves — it returned an empty list rather than
> raising, so every 6-hourly build silently re-emitted the same hardcoded seed listings. Both
> are fixed, and `backend/tests/test_api_scrapers.py` now pins the extraction so a site change
> breaks a test instead of quietly freezing the dataset.

A typical run pulls ~100 live listings across 50+ suburbs.

The deploy workflow additionally runs Playwright scrapers **in parallel** and merges them:

- **Parallel agents:** a CI matrix runs one job per source (`realestate.co.nz`, `trademe.co.nz`,
  `oneroof.co.nz`), each on its **own runner** (different IP) with a **different browser engine**
  (Chromium / Firefox) and a rotated, realistic browser signature (user-agent, viewport, locale,
  timezone, light stealth tweaks) to reduce blocking.
- **Merge + dedupe:** `scripts/merge_listings.py` combines the partials, dedupes by normalised
  address (keeping the richest record), assigns ids, and writes `frontend/public/listings.json`.
- **House photos only:** images are downloaded and self-hosted; agent/human headshots and logos
  are filtered out by URL keywords and image dimensions (Pillow), keeping landscape property
  photos.
- **Every 6 hours:** a `cron` schedule refreshes the data (plus on every push to `main`).

Sources & engines are configured in `scraper/sites.py`. Tunables via env:
`SCRAPE_PRICE_CEILING` (1000000), `SCRAPE_MAX_PAGES` (8), `SCRAPE_PRICE_MAX` (500000, Playwright
path). Run the HTTP scrapers with `python scripts/build_listings.py`, the browser scrapers with
`python scripts/scrape_listings.py` (or one via `SCRAPE_SOURCE=trademe.co.nz`).

**Why ingestion reaches above $500k.** In the sub-$500k Christchurch segment essentially nothing
publishes an asking price — it all sells by auction or deadline sale — so capping collection at
the buyer's budget leaves the valuation model with almost no real prices to calibrate on. A $650k
house with 4 bedrooms on 800m² is still a valid observation of how bedrooms and land are priced.
The buyer's actual budget is applied downstream by the hard filters in `scoring.py`, which is
where a preference belongs rather than in data collection.

> ⚠️ **Trade-offs of keyless scraping.** Real-estate sites use bot protection that frequently
> blocks CI servers, so a source — or a whole build — can legitimately return **no listings**;
> the site then shows an empty state rather than dummy data (parallel sources make a fully empty
> build less likely). Their terms also restrict scraping/redistribution; this is intended for
> personal use. Each run logs how many listings each source returned (Actions log). CSS selectors
> live in `scraper/sites.py` and may need updating when a site's HTML changes.

> Suburb medians and mortgage rates on the Insights page are indicative reference figures
> (no free live source) and are labelled as such.

### Photos

Search pages are aggressively bot-protected, but **detail pages are reachable over plain
HTTP** — so `scripts/photos.py` fetches each listing's page, extracts its gallery, picks the
largest variant of each distinct photo, verifies with Pillow that it is a plausible house
picture (dropping agent headshots, logos and thumbnails) and writes it under
`public/photos/`. Self-hosting matters: hotlinked mediaserver URLs rotate and expire, which
silently blanks the grid.

Typical coverage is ~85%. Listings without a photo render deterministic generated artwork
rather than an empty box, and any photo that 404s at runtime falls back to the same artwork.

## Quick start

### 1. Backend
```bash
python -m venv .venv
# Windows: .venv\Scripts\activate    macOS/Linux: source .venv/bin/activate
pip install -r backend/requirements.txt
cp .env.example .env            # then fill in LINZ_API_KEY etc. (optional to start)

cd backend
python -m app.seed              # load sample Christchurch listings + suburbs + rates
uvicorn app.main:app --reload --port 8000
```
API now at http://localhost:8000 (docs at `/docs`).

### 2. Frontend
```bash
cd frontend
npm install
python ../scripts/scrape_listings.py   # optional: scrape real listings into public/listings.json
npm run dev                            # http://localhost:3000  (self-contained, no backend)
```

> The frontend is a standalone static app — it loads real listings from `public/listings.json`
> (scraped from realestate.co.nz at build time) and computes scoring/finance in the browser. The
> Python backend is optional and used for LINZ enrichment and persistence.

### 3. Analysis engine

Nothing to install. Valuation, rent, growth, negotiation and the written per-listing analysis
are all computed in-process:

```bash
python scripts/provenance.py          # label observed vs modelled figures
python scripts/hedonic.py             # train the valuation model -> public/model.json
python scripts/generate_ai_insights.py  # write the per-listing analysis -> public/insights.json
```

HouseScout previously proxied these features to a local LM Studio (Gemma) server. That has
been removed: it only worked for one person on one machine with a GPU, an HTTPS page calling
`http://localhost` is blocked outright by some browsers, and nothing a subscriber pays for
should depend on it. The replacement is faster, free, identical for every user, works offline,
and cannot invent a fact about someone's largest purchase.

## Live data (scraping)
```bash
pip install playwright && playwright install chromium
# from repo root:
python -m scraper.run --dry-run          # collect & print, don't save
python -m scraper.run                     # collect, enrich with LINZ, save, rescore
python -m scraper.run --estimates         # also pull homes.co.nz/OneRoof estimates (slower)
python -m scraper.run --rates-only        # just refresh mortgage rates from interest.co.nz
```
The backend also scrapes listings + refreshes rates automatically every
`SCRAPE_INTERVAL_HOURS`. Mortgage rates can also be refreshed live from the
Insights page, and chat embeddings rebuilt from Settings.

> ⚠️ Scraping is for personal use only: honour each site's robots.txt/terms, keep the throttle on,
> and don't redistribute scraped data. A free **LINZ API key** (https://data.linz.govt.nz/) enables
> reliable land-area (backyard) data.

## Plans & monetisation

`/pricing` ships three tiers (`frontend/lib/subscription.ts`):

| Tier | Price | Unlocks |
|---|---|---|
| **Scout** | Free | 12 top matches, match score, mortgage + boarder calculator, payoff simulator, suburb table, buyer guide |
| **Buyer Pro** | $19/mo | Unlimited listings, modelled fair value, price position, negotiation room, growth forecast, Deal Radar, watchlist & compare, CSV export, printable reports |
| **Investor** | $49/mo | Rate stress testing, portfolio modelling, equity projections |

**Billing is not live.** The site is a static export, so all gating is client-side: it is a
product mechanism for building and testing the paywall, **not** a security boundary — anyone
can unlock every tier from the browser console, and the underlying data sits in
`listings.json` regardless.

Before charging real money, three things must change:

1. A payment provider (Stripe Checkout / Paddle) with a webhook recording subscriptions.
2. An authenticated `/api/entitlement` endpoint. `resolveEntitlement()` in
   `frontend/lib/subscription.ts` is the single seam to swap — every `<Gate>` follows.
3. **Gate the data, not just the UI:** serve the paid analysis (valuation, forecasts, Deal
   Radar) from that authenticated endpoint rather than the public JSON.

Also worth resolving before taking payment: the scraped sources' terms restrict
redistribution, which is a different question for a commercial product than for a personal
tool. And model confidence is currently **low** — see the roadmap in `docs/DATA_SOURCES.md`
for the highest-leverage fix (real sold-price history to train on).

## Tests
```bash
cd backend && python -m pytest -q     # engines, model, provenance, photo pipeline
cd frontend && npx tsc --noEmit       # typecheck
```

CI (`.github/workflows/ci.yml`) runs both on every push, plus an end-to-end smoke test of the
build pipeline.

## Run 24/7 on Windows
- **Backend + scheduler:** run `uvicorn app.main:app --port 8000` as a service via
  [NSSM](https://nssm.cc/) or Task Scheduler.
- **Frontend:** `npm run build && npm run start`, kept alive with `pm2` or a service wrapper.

## Key features
- **Matching:** hard filters (price ≤ cap, garage, backyard), townhouses ranked lowest, weighted
  0–100 score with rentability emphasised.
- **Finance:** mortgage P&I, boarder income with the **IRD $245/wk-per-boarder tax-free** rule
  (max 4), **accelerated-payoff simulator** ("years to mortgage-free"), yield & cashflow.
- **Valuation model:** modelled fair value with a confidence band and a feature-by-feature
  explanation, over/under-priced vs the model, predicted per-room and whole-house rent, a
  mean-reverting 10-year growth forecast, negotiation room, and a composite deal score
  (`scripts/hedonic.py` + `frontend/lib/predict.ts`).
- **Deal Radar:** the whole market ranked by opportunity rather than by fit.
- **Watchlist & compare:** shortlist properties and compare them side by side; CSV export
  and printable reports.
- **Analysis:** per-listing pros/cons & negotiation angles, listing Q&A and a
  mortgage/investment advisor — all deterministic and in-process, no model server.
- **Provenance:** every figure labelled observed / modelled / sample.
- **Insights:** suburb affordability-vs-yield table and live mortgage rates (interest.co.nz).
- **Map:** MapLibre listings map with score-coloured price markers (free OSM basemap).
- **Enrichment:** free LINZ land area + homes.co.nz/OneRoof estimates, RV and rental estimates.

See `docs/` for the data-source notes and roadmap.
