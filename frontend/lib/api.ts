// Client-side "API". Previously this proxied to a FastAPI backend; the app is now
// a fully static GitHub Pages site, so every method computes its result in the
// browser from bundled seed data + the ported finance/scoring/AI engines.
//
// The public surface (types, `api`, `fmt`) is unchanged so the pages/components
// keep working as-is.

import { DEFAULTS, LISTINGS, RATES, SUBURBS, RawListing } from "./data";
import { analyse, FinanceResult, Scenario } from "./finance";
import { defaultCriteria, scoreListing } from "./scoring";
import * as ai from "./ai";

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
// Build scored listings once (matches backend rescore_all with default criteria).
// --------------------------------------------------------------------------- //
function buildScored(): Listing[] {
  const c = defaultCriteria();
  return LISTINGS.map((raw: RawListing) => {
    const r = scoreListing(raw, c);
    const { days_on_market, source_id, ...rest } = raw;
    void days_on_market;
    void source_id;
    return {
      ...rest,
      score: {
        match_score: r.match_score,
        passes_filters: r.passes_filters,
        components: { components: r.components, rentable_rooms: r.rentable_rooms },
      },
    } as Listing;
  });
}

const SCORED: Listing[] = buildScored();
const byId = new Map<number, Listing>(SCORED.map((l) => [l.id, l]));
const rawById = new Map<number, RawListing>(LISTINGS.map((l) => [l.id, l]));

function num(v: string | null): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function filterAndSort(qs: string): Listing[] {
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

  let rows = SCORED.slice();
  if (suburb) rows = rows.filter((l) => l.suburb === suburb);
  if (propertyType) rows = rows.filter((l) => l.property_type === propertyType);
  if (maxPrice != null) rows = rows.filter((l) => l.price != null && l.price <= maxPrice);
  if (minBedrooms != null) rows = rows.filter((l) => (l.bedrooms ?? 0) >= minBedrooms);
  if (garageOnly) rows = rows.filter((l) => l.has_garage);
  if (passesOnly) rows = rows.filter((l) => l.score?.passes_filters);

  const score = (l: Listing) => l.score?.match_score ?? -Infinity;
  const days = (l: Listing) => rawById.get(l.id)?.days_on_market ?? Infinity;
  if (sort === "score") rows.sort((a, b) => score(b) - score(a));
  else if (sort === "price") rows.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
  else if (sort === "price_desc") rows.sort((a, b) => (b.price ?? -Infinity) - (a.price ?? -Infinity));
  else if (sort === "newest") rows.sort((a, b) => days(a) - days(b)); // fewer days on market = newer

  return rows.slice(offset, offset + limit);
}

function scenarioForListing(id: number, qs: string): Finance {
  const l = byId.get(id);
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

async function ready<T>(v: T): Promise<T> {
  return v;
}

export const api = {
  health: () => ready({ status: "ok", mode: "static" }),

  stats: async () => {
    const passing = SCORED.filter((l) => l.score?.passes_filters);
    const prices = passing.map((l) => l.price).filter((p): p is number => p != null);
    const avg = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null;
    const top = passing
      .slice()
      .sort((a, b) => (b.score?.match_score ?? 0) - (a.score?.match_score ?? 0))
      .slice(0, 3)
      .map((t) => ({ id: t.id, address: t.address, suburb: t.suburb, price: t.price, score: t.score?.match_score ?? null }));
    return {
      total_listings: SCORED.length,
      matching_listings: passing.length,
      avg_matching_price: avg != null ? Math.round(avg) : null,
      top,
    };
  },

  suburbs: () => ready([...SUBURBS].sort((a, b) => a.median_price - b.median_price)),
  rates: () => ready([...RATES].sort((a, b) => a.rate - b.rate)),

  listings: (qs = "") => ready(filterAndSort(qs)),
  listing: (id: number) => ready(byId.get(id) as Listing),

  financeForListing: (id: number, qs = "") => ready(scenarioForListing(id, qs)),
  scenario: (body: any) =>
    ready(
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
    ),
  financeDefaults: () => ready({ ...DEFAULTS }),

  // --- AI (runs in the browser against the configured LM Studio endpoint) ---
  aiHealth: () => ai.health(),

  insight: async (id: number, refresh = false) => {
    if (!refresh && insightCache.has(id)) {
      const c = insightCache.get(id)!;
      return { ok: true, content: c.content, model: c.model };
    }
    const l = byId.get(id);
    if (!l) return { ok: false, content: "Listing not found", model: null };
    const fin = scenarioForListing(id, "");
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
    // RAG-lite: ground the answer in the top matches by score (no embeddings client-side).
    const rows = SCORED.filter((l) => l.score?.passes_filters)
      .slice()
      .sort((a, b) => (b.score?.match_score ?? 0) - (a.score?.match_score ?? 0))
      .slice(0, 6);
    const context = rows.map((r) => {
      const fin = scenarioForListing(r.id, "");
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
  reindex: () =>
    ready({ ok: false, reason: "Semantic reindexing needs the optional Python backend; chat uses score-ranked matches instead." }),
  refreshRates: () =>
    ready({ ok: false, error: "Live rate scraping needs the optional Python backend. The rates shown are the bundled snapshot." }),
};

export const fmt = {
  money: (n?: number | null) =>
    n == null ? "—" : new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD", maximumFractionDigits: 0 }).format(n),
  num: (n?: number | null) => (n == null ? "—" : new Intl.NumberFormat("en-NZ").format(n)),
  pct: (n?: number | null) => (n == null ? "—" : `${n.toFixed(1)}%`),
};
