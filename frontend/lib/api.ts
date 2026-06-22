// Client-side "API". The app is a fully static GitHub Pages site, so every method
// computes its result in the browser. Listings are real data fetched from the Trade
// Me Property API at build time into /listings.json (see scripts/fetch-listings.mjs);
// scoring and all financial analysis run here from the ported engines.
//
// The public surface (types, `api`, `fmt`) is unchanged so the pages/components
// keep working as-is.

import { DEFAULTS, RATES, SUBURBS, RawListing } from "./data";
import { analyse, FinanceResult, Scenario } from "./finance";
import { defaultCriteria, scoreListing } from "./scoring";
import * as ai from "./ai";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

export type Enrichment = {
  land_area_m2?: number | null;
  rateable_value?: number | null;
  estimate_value?: number | null;
  rental_estimate_weekly?: number | null;
  last_sold_price?: number | null;
};

export type Score = {
  match_score: number;
  passes_filters: boolean;
  components?: { components?: Record<string, number>; rentable_rooms?: number } | null;
};

export type Listing = {
  id: number;
  source: string;
  url?: string | null;
  address?: string | null;
  suburb?: string | null;
  lat?: number | null;
  lng?: number | null;
  price?: number | null;
  price_text?: string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  car_spaces?: number | null;
  has_garage: boolean;
  land_area_m2?: number | null;
  floor_area_m2?: number | null;
  property_type?: string | null;
  description?: string | null;
  images: { url: string; position: number }[];
  enrichment?: Enrichment | null;
  score?: Score | null;
};

export type Finance = FinanceResult;

// --------------------------------------------------------------------------- //
// Load real listings (built into /listings.json) and score them once. Cached.
// --------------------------------------------------------------------------- //
type DataSet = {
  scored: Listing[];
  byId: Map<number, Listing>;
  rawById: Map<number, RawListing>;
};

let dataPromise: Promise<DataSet> | null = null;

function assetUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return `${BASE_PATH}/${path.replace(/^\//, "")}`;
}

async function fetchRawListings(): Promise<RawListing[]> {
  try {
    const res = await fetch(`${BASE_PATH}/listings.json`, { cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? (data as RawListing[]) : [];
  } catch {
    return [];
  }
}

function loadData(): Promise<DataSet> {
  if (dataPromise) return dataPromise;
  dataPromise = (async () => {
    const raw = await fetchRawListings();
    const c = defaultCriteria();
    const scored: Listing[] = raw.map((r) => {
      const s = scoreListing(r, c);
      return {
        id: r.id,
        source: r.source,
        url: r.url,
        address: r.address,
        suburb: r.suburb,
        lat: r.lat,
        lng: r.lng,
        price: r.price,
        price_text: r.price_text,
        bedrooms: r.bedrooms,
        bathrooms: r.bathrooms,
        car_spaces: r.car_spaces,
        has_garage: r.has_garage,
        land_area_m2: r.land_area_m2,
        floor_area_m2: r.floor_area_m2,
        property_type: r.property_type,
        description: r.description,
        // Photos are self-hosted under /photos; resolve against the Pages base path.
        images: (r.images || []).map((im) => ({ url: assetUrl(im.url), position: im.position })),
        enrichment: r.enrichment,
        score: {
          match_score: s.match_score,
          passes_filters: s.passes_filters,
          components: { components: s.components, rentable_rooms: s.rentable_rooms },
        },
      };
    });
    return {
      scored,
      byId: new Map(scored.map((l) => [l.id, l])),
      rawById: new Map(raw.map((l) => [l.id, l])),
    };
  })();
  return dataPromise;
}

function num(v: string | null): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function filterAndSort(d: DataSet, qs: string): Listing[] {
  const p = new URLSearchParams(qs.replace(/^\?/, ""));
  const suburb = p.get("suburb");
  const propertyType = p.get("property_type");
  const maxPrice = num(p.get("max_price"));
  const minBedrooms = num(p.get("min_bedrooms"));
  const garageOnly = p.get("garage_only") === "true";
  const passesOnly = p.get("passes_only") !== "false"; // default true (backend default)
  const sort = p.get("sort") || "score";
  const limit = Math.min(num(p.get("limit")) ?? 60, 200);
  const offset = num(p.get("offset")) ?? 0;

  let rows = d.scored.slice();
  if (suburb) rows = rows.filter((l) => l.suburb === suburb);
  if (propertyType) rows = rows.filter((l) => l.property_type === propertyType);
  if (maxPrice != null) rows = rows.filter((l) => l.price != null && l.price <= maxPrice);
  if (minBedrooms != null) rows = rows.filter((l) => (l.bedrooms ?? 0) >= minBedrooms);
  if (garageOnly) rows = rows.filter((l) => l.has_garage);
  if (passesOnly) rows = rows.filter((l) => l.score?.passes_filters);

  const score = (l: Listing) => l.score?.match_score ?? -Infinity;
  const days = (l: Listing) => d.rawById.get(l.id)?.days_on_market ?? Infinity;
  if (sort === "score") rows.sort((a, b) => score(b) - score(a));
  else if (sort === "price") rows.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
  else if (sort === "price_desc") rows.sort((a, b) => (b.price ?? -Infinity) - (a.price ?? -Infinity));
  else if (sort === "newest") rows.sort((a, b) => days(a) - days(b)); // fewer days on market = newer

  return rows.slice(offset, offset + limit);
}

function scenarioFor(d: DataSet, id: number, qs: string): Finance {
  const l = d.byId.get(id);
  const p = new URLSearchParams(qs.replace(/^\?/, ""));
  const s: Scenario = {
    price: l?.price ?? DEFAULTS.preapproval,
    deposit: num(p.get("deposit")) ?? DEFAULTS.deposit,
    annual_rate: num(p.get("annual_rate")) ?? DEFAULTS.annual_rate,
    term_years: num(p.get("term_years")) ?? DEFAULTS.term_years,
    bedrooms: l?.bedrooms ?? null,
    weekly_rent: num(p.get("weekly_rent")) ?? DEFAULTS.weekly_rent,
    occupancy: num(p.get("occupancy")) ?? 1.0,
    reinvest_boarder_income: p.get("reinvest") !== "false",
  };
  return analyse(s);
}

const insightCache = new Map<number, { content: string; model: string | null }>();

export const api = {
  health: async () => ({ status: "ok", mode: "static" }),

  stats: async () => {
    const d = await loadData();
    const passing = d.scored.filter((l) => l.score?.passes_filters);
    const prices = passing.map((l) => l.price).filter((p): p is number => p != null);
    const avg = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null;
    const top = passing
      .slice()
      .sort((a, b) => (b.score?.match_score ?? 0) - (a.score?.match_score ?? 0))
      .slice(0, 3)
      .map((t) => ({ id: t.id, address: t.address, suburb: t.suburb, price: t.price, score: t.score?.match_score ?? null }));
    return {
      total_listings: d.scored.length,
      matching_listings: passing.length,
      avg_matching_price: avg != null ? Math.round(avg) : null,
      top,
    };
  },

  suburbs: async () => [...SUBURBS].sort((a, b) => a.median_price - b.median_price),
  rates: async () => [...RATES].sort((a, b) => a.rate - b.rate),

  listings: async (qs = "") => filterAndSort(await loadData(), qs),
  listing: async (id: number) => (await loadData()).byId.get(id) as Listing,

  financeForListing: async (id: number, qs = "") => scenarioFor(await loadData(), id, qs),
  scenario: async (body: any) =>
    analyse({
      price: body.price,
      deposit: body.deposit ?? DEFAULTS.deposit,
      annual_rate: body.annual_rate ?? DEFAULTS.annual_rate,
      term_years: body.term_years ?? DEFAULTS.term_years,
      bedrooms: body.bedrooms,
      weekly_rent: body.weekly_rent ?? DEFAULTS.weekly_rent,
      occupancy: body.occupancy ?? 1.0,
      reinvest_boarder_income: body.reinvest_boarder_income ?? true,
    }),
  financeDefaults: async () => ({ ...DEFAULTS }),

  // --- AI (runs in the browser against the configured LM Studio endpoint) ---
  aiHealth: () => ai.health(),

  insight: async (id: number, refresh = false) => {
    if (!refresh && insightCache.has(id)) {
      const c = insightCache.get(id)!;
      return { ok: true, content: c.content, model: c.model };
    }
    const d = await loadData();
    const l = d.byId.get(id);
    if (!l) return { ok: false, content: "Listing not found", model: null };
    const fin = scenarioFor(d, id, "");
    const listingPayload = {
      address: l.address, suburb: l.suburb, price: l.price, price_text: l.price_text,
      bedrooms: l.bedrooms, bathrooms: l.bathrooms, has_garage: l.has_garage,
      land_area_m2: l.land_area_m2, property_type: l.property_type, description: l.description,
    };
    const score = { match_score: l.score?.match_score, components: l.score?.components?.components };
    const r = await ai.listingInsight(listingPayload, fin, score);
    if (r.ok) insightCache.set(id, { content: r.content, model: r.model });
    return r;
  },

  chat: async (question: string) => {
    const d = await loadData();
    // RAG-lite: ground the answer in the top matches by score (no embeddings client-side).
    const rows = d.scored.filter((l) => l.score?.passes_filters)
      .slice()
      .sort((a, b) => (b.score?.match_score ?? 0) - (a.score?.match_score ?? 0))
      .slice(0, 6);
    const context = rows.map((r) => {
      const fin = scenarioFor(d, r.id, "");
      return {
        address: r.address, suburb: r.suburb, price: r.price,
        bedrooms: r.bedrooms, bathrooms: r.bathrooms, has_garage: r.has_garage,
        land_area_m2: r.land_area_m2, property_type: r.property_type,
        match_score: r.score?.match_score ?? null,
        rentable_rooms: fin.boarder.rentable_rooms,
        monthly_boarder_income: fin.monthly_boarder_income,
        net_monthly_outlay: fin.net_monthly_outlay,
        gross_yield_pct: fin.gross_yield_pct,
        payoff_years_accelerated: fin.accelerated.payoff_years,
      };
    });
    return ai.chatAssistant(question, context);
  },

  advisor: (question: string) => ai.advisor(question),

  // --- No-ops in the static build (need a backend) — return friendly notices ---
  reindex: async () =>
    ({ ok: false, reason: "Semantic reindexing needs the optional Python backend; chat uses score-ranked matches instead." }),
  refreshRates: async () =>
    ({ ok: false, error: "Live rate scraping needs the optional Python backend. The rates shown are the bundled snapshot." }),
};

export const fmt = {
  money: (n?: number | null) =>
    n == null ? "—" : new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD", maximumFractionDigits: 0 }).format(n),
  num: (n?: number | null) => (n == null ? "—" : new Intl.NumberFormat("en-NZ").format(n)),
  pct: (n?: number | null) => (n == null ? "—" : `${n.toFixed(1)}%`),
};
