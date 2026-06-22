// Reference data + types for the static app.
//
// Listings are NOT bundled here — they are fetched live from the Trade Me Property
// API at build time into `public/listings.json` (see scripts/fetch-listings.mjs)
// and loaded at runtime by lib/api.ts. Suburb medians and mortgage rates below are
// indicative reference figures (no free live source); they're labelled as such in
// the UI.

export type RawListing = {
  id: number;
  source: string;
  source_id: string;
  url: string;
  address: string;
  suburb: string;
  lat: number;
  lng: number;
  price: number;
  price_text: string;
  bedrooms: number;
  bathrooms: number;
  car_spaces: number;
  has_garage: boolean;
  land_area_m2: number | null;
  floor_area_m2: number | null;
  property_type: string;
  description: string;
  days_on_market: number; // derived from the original listing_date offsets
  images: { url: string; position: number }[];
  enrichment: {
    land_area_m2: number | null;
    rateable_value: number | null;
    estimate_value: number | null;
    rental_estimate_weekly: number | null;
  };
};

export type Suburb = {
  name: string;
  median_price: number;
  median_rent_weekly: number;
  rental_yield: number;
  distance_cbd_km: number;
  growth_5yr_pct: number;
  notes: string;
};

export type MortgageRate = { bank: string; term_label: string; rate: number };

// Buyer profile defaults (ported from backend/app/config.py).
export const DEFAULTS = {
  max_price: 500_000,
  preapproval: 480_000,
  deposit: 50_000,
  annual_rate: 0.0519,
  term_years: 30,
  weekly_rent: 220,
};

// Affordable Christchurch suburbs (illustrative figures).
export const SUBURBS: Suburb[] = [
  { name: "Aranui", median_price: 430_000, median_rent_weekly: 480, rental_yield: 5.8, distance_cbd_km: 22, growth_5yr_pct: 8.0, notes: "Affordable east-side; rising rental demand." },
  { name: "Hornby", median_price: 510_000, median_rent_weekly: 540, rental_yield: 5.5, distance_cbd_km: 19, growth_5yr_pct: 11.0, notes: "West; near industry/transport, strong rentals." },
  { name: "Hoon Hay", median_price: 560_000, median_rent_weekly: 560, rental_yield: 5.2, distance_cbd_km: 25, growth_5yr_pct: 6.0, notes: "Popular SW family suburb." },
  { name: "Linwood", median_price: 460_000, median_rent_weekly: 510, rental_yield: 5.8, distance_cbd_km: 24, growth_5yr_pct: 4.0, notes: "Close to CBD, gentrifying." },
  { name: "Woolston", median_price: 480_000, median_rent_weekly: 520, rental_yield: 5.6, distance_cbd_km: 21, growth_5yr_pct: 5.5, notes: "Inner-east, good value." },
  { name: "New Brighton", median_price: 470_000, median_rent_weekly: 500, rental_yield: 5.5, distance_cbd_km: 18, growth_5yr_pct: 9.0, notes: "Coastal east; regeneration underway." },
  { name: "Bishopdale", median_price: 590_000, median_rent_weekly: 560, rental_yield: 4.9, distance_cbd_km: 23, growth_5yr_pct: 7.0, notes: "Established NW suburb." },
  { name: "Phillipstown", median_price: 450_000, median_rent_weekly: 500, rental_yield: 5.8, distance_cbd_km: 26, growth_5yr_pct: 3.0, notes: "Very central, smaller sections." },
  { name: "Wainoni", median_price: 440_000, median_rent_weekly: 480, rental_yield: 5.7, distance_cbd_km: 20, growth_5yr_pct: 8.5, notes: "Affordable east." },
  { name: "Riccarton", median_price: 580_000, median_rent_weekly: 600, rental_yield: 5.4, distance_cbd_km: 30, growth_5yr_pct: 4.0, notes: "Student rental hotspot; units common." },
];

// Indicative June-2026 fixed mortgage rates (lowest across major banks).
export const RATES: MortgageRate[] = [
  { bank: "ASB", term_label: "6mo", rate: 0.0449 },
  { bank: "BNZ", term_label: "6mo", rate: 0.0449 },
  { bank: "Kiwibank", term_label: "6mo", rate: 0.0449 },
  { bank: "ASB", term_label: "1yr", rate: 0.0465 },
  { bank: "BNZ", term_label: "1yr", rate: 0.0465 },
  { bank: "BNZ", term_label: "2yr", rate: 0.0519 },
  { bank: "Westpac", term_label: "2yr", rate: 0.0519 },
  { bank: "Westpac", term_label: "3yr", rate: 0.0529 },
  { bank: "Westpac", term_label: "4yr", rate: 0.0539 },
];
