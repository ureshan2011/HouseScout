// Client-side "API". The site is static, so every method computes its result in the
// browser: listings come from /listings.json, built by the scrape pipeline, and
// scoring and financial analysis run here from the ported engines.

import { RATES, SUBURBS, RawListing, Provenance, DataQuality } from "./data";
import { analyse, FinanceResult, Scenario } from "./finance";
import { defaultCriteria, scoreListing } from "./scoring";
import { loadProfile, profileSignature } from "./criteria";
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
  /** District key from scraper/regions.py, e.g. "christchurch-city". */
  region?: string | null;
  /** Display label for that district, e.g. "Christchurch, Canterbury". */
  region_name?: string | null;
  lat?: number | null;
  lng?: number | null;
  price?: number | null;
  /** Valuation-model estimate; the figure to show when `price` is null. */
  price_estimate?: number | null;
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
  days_on_market?: number | null;
  provenance?: Provenance | null;
  estimated_fields?: string[] | null;
  data_quality?: DataQuality | null;
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

// Two caches: the listings file is fetched once, while the scored view is keyed on
// the profile signature so editing the budget in Settings re-ranks the site at once.
let rawPromise: Promise<RawListing[]> | null = null;
let scoredCache: { signature: string; data: DataSet } | null = null;

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

async function loadData(): Promise<DataSet> {
  const signature = profileSignature();
  if (scoredCache && scoredCache.signature === signature) return scoredCache.data;

  if (!rawPromise) rawPromise = fetchRawListings();
  const raw = await rawPromise;

  const build = (): DataSet => {
    const c = defaultCriteria();
    const scored: Listing[] = raw.map((r) => {
      const s = scoreListing(r, c);
      return {
        id: r.id,
        source: r.source,
        url: r.url,
        address: r.address,
        suburb: r.suburb,
        region: r.region,
        region_name: r.region_name,
        lat: r.lat,
        lng: r.lng,
        price: r.price,
        price_estimate: r.price_estimate,
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
        days_on_market: r.days_on_market,
        provenance: r.provenance,
        estimated_fields: r.estimated_fields,
        data_quality: r.data_quality,
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
  };

  const data = build();
  scoredCache = { signature, data };
  return data;
}

function num(v: string | null): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Comma-separated multi-select param -> lowercased set, or null when absent. */
function multi(raw: string | null): Set<string> | null {
  if (!raw) return null;
  const values = raw
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  return values.length ? new Set(values) : null;
}

/**
 * Filter + sort the scored listings.
 *
 * Every criterion here is a query parameter rather than a constant, and the Listings
 * page mirrors them into the URL, so a search is shareable and survives a reload.
 * Unrecognised parameters are ignored, and an absent parameter never filters.
 *
 * Supported: region, suburb, property_type (multi), min_price, max_price,
 * min_bedrooms, max_bedrooms, min_bathrooms, min_land, max_land, garage_only,
 * priced_only, q, passes_only, sort, limit, offset.
 */
function applyFilters(d: DataSet, qs: string): Listing[] {
  const p = new URLSearchParams(qs.replace(/^\?/, ""));
  const regions = multi(p.get("region"));
  const suburbs = multi(p.get("suburb"));
  const propertyTypes = multi(p.get("property_type"));
  const minPrice = num(p.get("min_price"));
  const maxPrice = num(p.get("max_price"));
  const minBedrooms = num(p.get("min_bedrooms"));
  const maxBedrooms = num(p.get("max_bedrooms"));
  const minBathrooms = num(p.get("min_bathrooms"));
  const minLand = num(p.get("min_land"));
  const maxLand = num(p.get("max_land"));
  const garageOnly = p.get("garage_only") === "true";
  // "Only listings with a published asking price" — i.e. hide the ones where the
  // headline figure is our model's estimate. Most NZ stock sells by auction or
  // deadline sale, so this is a meaningful distinction, not a cosmetic one.
  const pricedOnly = p.get("priced_only") === "true";
  const q = (p.get("q") || "").trim().toLowerCase();
  const passesOnly = p.get("passes_only") !== "false"; // default true (backend default)
  const sort = p.get("sort") || "score";

  // The figure to reason about: published where there is one, else the model's
  // estimate. Filtering on `price` alone would drop the 80%+ of listings that publish
  // none, which is exactly the stock this buyer is shopping in.
  const workingPrice = (l: Listing) => l.price ?? l.price_estimate ?? null;
  const land = (l: Listing) => l.enrichment?.land_area_m2 ?? l.land_area_m2 ?? null;

  let rows = d.scored.slice();
  if (regions) rows = rows.filter((l) => regions.has((l.region || "").toLowerCase()));
  if (suburbs) rows = rows.filter((l) => suburbs.has((l.suburb || "").toLowerCase()));
  if (propertyTypes)
    rows = rows.filter((l) => propertyTypes.has((l.property_type || "").toLowerCase()));
  if (minPrice != null)
    rows = rows.filter((l) => {
      const v = workingPrice(l);
      return v != null && v >= minPrice;
    });
  if (maxPrice != null)
    rows = rows.filter((l) => {
      const v = workingPrice(l);
      return v != null && v <= maxPrice;
    });
  if (minBedrooms != null) rows = rows.filter((l) => (l.bedrooms ?? 0) >= minBedrooms);
  if (maxBedrooms != null) rows = rows.filter((l) => (l.bedrooms ?? 0) <= maxBedrooms);
  if (minBathrooms != null) rows = rows.filter((l) => (l.bathrooms ?? 0) >= minBathrooms);
  // A land filter only excludes listings whose land area is *known* to miss it —
  // an unknown land area is not evidence of a small section, and dropping those
  // rows would hide most apartments-excluded stock for no reason.
  if (minLand != null)
    rows = rows.filter((l) => {
      const v = land(l);
      return v == null || v >= minLand;
    });
  if (maxLand != null)
    rows = rows.filter((l) => {
      const v = land(l);
      return v == null || v <= maxLand;
    });
  if (garageOnly) rows = rows.filter((l) => l.has_garage);
  if (pricedOnly) rows = rows.filter((l) => l.price != null);
  if (q) {
    rows = rows.filter((l) =>
      [l.address, l.suburb, l.region_name, l.description, l.property_type]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }
  if (passesOnly) rows = rows.filter((l) => l.score?.passes_filters);

  const score = (l: Listing) => l.score?.match_score ?? -Infinity;
  const days = (l: Listing) => d.rawById.get(l.id)?.days_on_market ?? Infinity;

  if (sort === "score") rows.sort((a, b) => score(b) - score(a));
  else if (sort === "price")
    rows.sort((a, b) => (workingPrice(a) ?? Infinity) - (workingPrice(b) ?? Infinity));
  else if (sort === "price_desc")
    rows.sort((a, b) => (workingPrice(b) ?? -Infinity) - (workingPrice(a) ?? -Infinity));
  else if (sort === "newest") rows.sort((a, b) => days(a) - days(b)); // fewer days = newer
  else if (sort === "land")
    rows.sort((a, b) => (land(b) ?? -Infinity) - (land(a) ?? -Infinity));
  else if (sort === "bedrooms") rows.sort((a, b) => (b.bedrooms ?? 0) - (a.bedrooms ?? 0));

  return rows;
}

/** Filtered, sorted and paged — what the Listings page renders. */
function filterAndSort(d: DataSet, qs: string): Listing[] {
  const p = new URLSearchParams(qs.replace(/^\?/, ""));
  const limit = Math.min(num(p.get("limit")) ?? 60, 200);
  const offset = num(p.get("offset")) ?? 0;
  return applyFilters(d, qs).slice(offset, offset + limit);
}

export type Facet = { value: string; label: string; count: number };

/**
 * The filter options actually present in the data, with counts.
 *
 * Derived from the listings rather than from a static list so the menus can never
 * offer a district or suburb that this build did not scrape — which matters now that
 * coverage is configurable per deploy.
 *
 * An optional query scopes the counts: the Listings page passes the selected
 * districts when building the suburb menu, so picking Dunedin narrows the suburb
 * chips to Dunedin's suburbs instead of listing every suburb in the country.
 */
function facetsOf(d: DataSet, qs = "") {
  const rows = qs ? applyFilters(d, qs) : d.scored;
  const tally = (
    pick: (l: Listing) => string | null | undefined,
    label: (l: Listing) => string | null | undefined,
  ): Facet[] => {
    const counts = new Map<string, { label: string; count: number }>();
    for (const l of rows) {
      const value = (pick(l) || "").trim();
      if (!value) continue;
      const existing = counts.get(value);
      if (existing) existing.count += 1;
      else counts.set(value, { label: (label(l) || value).trim(), count: 1 });
    }
    return [...counts.entries()]
      .map(([value, v]) => ({ value, label: v.label, count: v.count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  };

  return {
    regions: tally(
      (l) => l.region,
      (l) => l.region_name,
    ),
    suburbs: tally(
      (l) => l.suburb,
      (l) => l.suburb,
    ),
    propertyTypes: tally(
      (l) => l.property_type,
      (l) => l.property_type,
    ),
  };
}

function scenarioFor(d: DataSet, id: number, qs: string): Finance {
  const l = d.byId.get(id);
  const p = new URLSearchParams(qs.replace(/^\?/, ""));
  // Query string wins, then the buyer's saved profile, then the factory defaults —
  // so a deposit or rate changed in Settings flows through every listing's finance
  // panel without the caller having to pass it.
  const prof = loadProfile();
  const s: Scenario = {
    // Mortgage maths needs a figure; fall back to the model's estimate, then to
    // the pre-approval ceiling.
    price: l?.price ?? l?.price_estimate ?? prof.preapproval,
    deposit: num(p.get("deposit")) ?? prof.deposit,
    annual_rate: num(p.get("annual_rate")) ?? prof.annual_rate,
    term_years: num(p.get("term_years")) ?? prof.term_years,
    bedrooms: l?.bedrooms ?? null,
    weekly_rent: num(p.get("weekly_rent")) ?? prof.weekly_rent,
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
    const prices = passing
      .map((l) => l.price ?? l.price_estimate)
      .filter((p): p is number => p != null);
    const avg = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null;
    const top = passing
      .slice()
      .sort((a, b) => (b.score?.match_score ?? 0) - (a.score?.match_score ?? 0))
      .slice(0, 3)
      .map((t) => ({
        id: t.id, address: t.address, suburb: t.suburb,
        price: t.price ?? t.price_estimate, score: t.score?.match_score ?? null,
      }));
    return {
      total_listings: d.scored.length,
      matching_listings: passing.length,
      avg_matching_price: avg != null ? Math.round(avg) : null,
      top,
    };
  },

  /**
   * A market snapshot measured from this build's listings.
   *
   * Replaces the hand-written commentary that used to sit on the Insights page:
   * these numbers move with the data instead of with whoever last edited the copy.
   */
  market: async () => {
    const d = await loadData();
    const rows = d.scored;
    const prices = rows
      .map((l) => l.price ?? l.price_estimate)
      .filter((p): p is number => p != null)
      .sort((a, b) => a - b);
    const median = (xs: number[]) => (xs.length ? xs[Math.floor(xs.length / 2)] : null);

    const METHODS: [RegExp, string][] = [
      [/auction/i, "Auction"],
      [/deadline/i, "Deadline sale"],
      [/negotiation/i, "By negotiation"],
      [/tender/i, "Tender"],
      [/enquiries over/i, "Enquiries over"],
      [/poa|price on application/i, "Price on application"],
    ];
    const methods = new Map<string, number>();
    for (const l of rows) {
      const text = l.price_text || "";
      const hit = METHODS.find(([re]) => re.test(text));
      const label = hit ? hit[1] : l.price != null ? "Asking price" : "Not stated";
      methods.set(label, (methods.get(label) ?? 0) + 1);
    }

    const land = rows
      .map((l) => l.enrichment?.land_area_m2 ?? l.land_area_m2)
      .filter((v): v is number => v != null)
      .sort((a, b) => a - b);

    return {
      total: rows.length,
      medianPrice: median(prices),
      lowPrice: prices[0] ?? null,
      highPrice: prices[prices.length - 1] ?? null,
      publishedPriceShare: rows.length ? rows.filter((l) => l.price != null).length / rows.length : 0,
      garageShare: rows.length ? rows.filter((l) => l.has_garage).length / rows.length : 0,
      medianBedrooms: median(rows.map((l) => l.bedrooms ?? 0).filter(Boolean).sort((a, b) => a - b)),
      medianLand: median(land),
      methods: [...methods.entries()]
        .map(([label, count]) => ({ label, count, share: count / Math.max(1, rows.length) }))
        .sort((a, b) => b.count - a.count),
    };
  },

  suburbs: async () => [...SUBURBS].sort((a, b) => a.median_price - b.median_price),
  rates: async () => [...RATES].sort((a, b) => a.rate - b.rate),

  listings: async (qs = "") => filterAndSort(await loadData(), qs),
  listing: async (id: number) => (await loadData()).byId.get(id) as Listing,

  financeForListing: async (id: number, qs = "") => scenarioFor(await loadData(), id, qs),
  scenario: async (body: any) => {
    const prof = loadProfile();
    return analyse({
      price: body.price,
      deposit: body.deposit ?? prof.deposit,
      annual_rate: body.annual_rate ?? prof.annual_rate,
      term_years: body.term_years ?? prof.term_years,
      bedrooms: body.bedrooms,
      weekly_rent: body.weekly_rent ?? prof.weekly_rent,
      occupancy: body.occupancy ?? 1.0,
      reinvest_boarder_income: body.reinvest_boarder_income ?? true,
    });
  },
  financeDefaults: async () => {
    const p = loadProfile();
    return {
      max_price: p.max_price,
      preapproval: p.preapproval,
      deposit: p.deposit,
      annual_rate: p.annual_rate,
      term_years: p.term_years,
      weekly_rent: p.weekly_rent,
    };
  },

  /** Filter options present in this build's data, with counts. Optionally scoped. */
  facets: async (qs = "") => facetsOf(await loadData(), qs),

  // --- Analysis (all local: baked insights + the in-browser reasoning engine) ---
  engine: async () => ({ name: ai.ENGINE_NAME, local: true }),

  insight: async (id: number) => {
    if (insightCache.has(id)) {
      const c = insightCache.get(id)!;
      return { ok: true, content: c.content, model: c.model };
    }
    const baked = await ai.bakedInsightFor(id);
    if (baked) {
      insightCache.set(id, { content: baked.content, model: baked.model });
      return baked;
    }
    return ai.listingInsight();
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

  // --- Needs the optional Python backend — return friendly notices ---
  refreshRates: async () =>
    ({ ok: false, error: "Live rate scraping needs the optional Python backend. The rates shown are the bundled snapshot." }),
};

export const fmt = {
  money: (n?: number | null) =>
    n == null ? "—" : new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD", maximumFractionDigits: 0 }).format(n),
  num: (n?: number | null) => (n == null ? "—" : new Intl.NumberFormat("en-NZ").format(n)),
  pct: (n?: number | null) => (n == null ? "—" : `${n.toFixed(1)}%`),
};
