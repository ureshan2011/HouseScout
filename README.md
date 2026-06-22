# 🏠 HouseScout — Christchurch House-Buying Intelligence

An AI-powered platform to find, analyse and finance a first home in **Christchurch, NZ**, built
around one strategy: **buy under $500k with a garage + backyard, live in it, rent the spare rooms to
boarders, and pay the mortgage off as fast as possible.**

It scrapes listings, enriches them with free official **LINZ** land data, ranks them against your
criteria, runs full **mortgage + boarder-income + accelerated-payoff** analysis, and adds an AI layer
(recommendations, chat, mortgage/investment advice) powered by your **local LM Studio (Gemma)** — so
the smart features run 24/7 on your own RTX 4080 with zero API cost.

> Personal-use tool. Property estimates are indicative, not registered valuations.
> Land data © LINZ (CC-BY 4.0). Not financial advice.

## Architecture

```
backend/    FastAPI · SQLAlchemy · SQLite · APScheduler   (API, scoring, finance, AI proxy)
scraper/    Playwright scrapers + LINZ enrichment          (run by CLI or the scheduler)
frontend/   Next.js 15 · TypeScript · Tailwind · Recharts  (dashboard)
data/        SQLite db + image cache (gitignored)
```

The finance and scoring engines are **pure functions** (`backend/app/finance.py`,
`backend/app/scoring.py`) with unit tests — the trustworthy core of the app. They are
mirrored 1:1 in TypeScript (`frontend/lib/finance.ts`, `frontend/lib/scoring.ts`) so the
app can also run **fully static**, with no backend at all.

## Two ways to run it

| Mode | What runs | Data | AI |
|------|-----------|------|----|
| **Static web app** (GitHub Pages) | Just the frontend, entirely in the browser | Bundled sample listings + ported finance/scoring engines | Calls your local LM Studio endpoint directly from the browser |
| **Full stack** (local/24-7) | FastAPI + SQLite + scheduler + Playwright scraper | Live scraped + LINZ-enriched listings in a database | Local Gemma via the backend proxy |

The static build is the zero-setup way to try everything (matching, scoring, the financial
planner, the map, charts). Run the Python backend when you want live scraping, LINZ land
data and a persistent database.

## Deploy to GitHub Pages (static web app)

The repo ships a workflow (`.github/workflows/deploy.yml`) that builds the Next.js static
export and publishes it to Pages on every push to `main`.

1. In the repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Push to `main` (or run the workflow manually). The site goes live at
   `https://<user>.github.io/<repo>/`.

The workflow sets `NEXT_PUBLIC_BASE_PATH=/<repo>` automatically so assets and links resolve
under the project sub-path. To build it yourself:

```bash
cd frontend
npm ci
NEXT_PUBLIC_BASE_PATH=/<repo> npm run build   # static site in frontend/out/
```

For a user/org root site (`https://<user>.github.io/`) or a custom domain, leave
`NEXT_PUBLIC_BASE_PATH` unset.

**AI in the static build:** the frontend talks to an OpenAI-compatible endpoint (LM Studio)
directly from your browser — set the endpoint under **Settings**. Browsers treat
`http://localhost` as trusted, so an HTTPS Pages site can still reach a local LM Studio
server (enable CORS in LM Studio if requests are blocked). Everything else works offline.

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
npm run dev                     # http://localhost:3000  (self-contained: runs on bundled data)
```

> The frontend is now a standalone static app — it computes scoring/finance in the browser
> from bundled sample data and no longer proxies to the backend. The Python backend is
> optional and used for live scraping, LINZ enrichment and persistence.

### 3. Local AI (optional but recommended)
1. Install **LM Studio** on your Windows PC and load a Gemma model (e.g. `gemma-3-27b-it`).
2. Load an embedding model too (e.g. `nomic-embed-text`) for richer RAG.
3. Start LM Studio's **local server** (default `http://localhost:1234`).
4. Set `LMSTUDIO_*` in `.env`. The dashboard shows "Gemma online" when connected.

Everything works without LM Studio — AI features simply report "offline".

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

## Tests
```bash
cd backend && python -m pytest -q
```

## Run 24/7 on Windows
- **Backend + scheduler:** run `uvicorn app.main:app --port 8000` as a service via
  [NSSM](https://nssm.cc/) or Task Scheduler.
- **Frontend:** `npm run build && npm run start`, kept alive with `pm2` or a service wrapper.
- Keep **LM Studio** running with the local server enabled.

## Key features
- **Matching:** hard filters (price ≤ cap, garage, backyard), townhouses ranked lowest, weighted
  0–100 score with rentability emphasised.
- **Finance:** mortgage P&I, boarder income with the **IRD $245/wk-per-boarder tax-free** rule
  (max 4), **accelerated-payoff simulator** ("years to mortgage-free"), yield & cashflow.
- **AI:** per-listing pros/cons & negotiation angles, embedding-backed RAG chat over your
  matches (with score-ordered fallback), and a mortgage/investment advisor — all on local Gemma.
- **Insights:** suburb affordability-vs-yield table and live mortgage rates (interest.co.nz).
- **Map:** MapLibre listings map with score-coloured price markers (free OSM basemap).
- **Enrichment:** free LINZ land area + homes.co.nz/OneRoof estimates, RV and rental estimates.

See `docs/` for the data-source notes and roadmap.
