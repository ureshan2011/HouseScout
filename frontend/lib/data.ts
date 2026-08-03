// Reference data + types for the static app.
//
// Listings are NOT bundled here — they are scraped at build time into
// `public/listings.json` (see scripts/build_listings.py) and loaded at runtime by
// lib/api.ts. Suburb medians and mortgage rates below are indicative reference
// figures (no free live source); they're labelled as such in the UI.

// Where each field on a listing came from. Written by scripts/provenance.py.
//   observed        – published by the source listing
//   not_published   – the source states no price (auction / deadline / POA)
//   modelled        – produced by our valuation model, not sourced
//   suburb_centroid – map pin is the suburb, not a geocode of the section
export type Provenance = {
  price: "observed" | "not_published";
  address: "observed";
  bedrooms: "observed" | "unknown";
  bathrooms: "observed" | "unknown";
  land_area_m2: "observed" | "unknown";
  floor_area_m2: "observed" | "unknown";
  coordinates: "suburb_centroid" | "geocoded";
  rateable_value: "modelled" | "unknown";
  estimate_value: "modelled" | "unknown";
  rental_estimate_weekly: "modelled" | "unknown";
  price_estimate: "modelled" | "unknown";
  photos: "source" | "none";
  record: "scraped";
};

/** Whether the headline price is the vendor's or the model's. */
export type DataQuality = "observed" | "estimated";

export type RawListing = {
  id: number;
  source: string;
  source_id: string;
  url: string;
  address: string;
  suburb: string;
  /** District key from scraper/regions.py, e.g. "christchurch-city". */
  region?: string | null;
  /** Display label for that district, e.g. "Christchurch, Canterbury". */
  region_name?: string | null;
  lat: number;
  lng: number;
  /** Null when the listing publishes no figure (auction / deadline / POA). */
  price: number | null;
  /** The valuation model's estimate, written by scripts/hedonic.py. Always present. */
  price_estimate?: number | null;
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
  provenance?: Provenance | null;
  estimated_fields?: string[] | null;
  data_quality?: DataQuality | null;
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

// The buyer profile moved to lib/criteria.ts, where it is editable and persisted
// per-browser. Its FACTORY_DEFAULTS hold the values that used to live here.
export { FACTORY_DEFAULTS as DEFAULTS } from "./criteria";

// Affordable Christchurch suburbs (illustrative figures, June 2026).
export const SUBURBS: Suburb[] = [
  { name: "Aranui", median_price: 410_000, median_rent_weekly: 460, rental_yield: 5.8, distance_cbd_km: 8.5, growth_5yr_pct: 8.0, notes: "Most affordable east-side; rising rental demand. New community facilities." },
  { name: "Hornby", median_price: 470_000, median_rent_weekly: 500, rental_yield: 5.5, distance_cbd_km: 10, growth_5yr_pct: 11.0, notes: "Strong employment area near industry hub. Excellent transport." },
  { name: "Hoon Hay", median_price: 480_000, median_rent_weekly: 480, rental_yield: 5.2, distance_cbd_km: 5.5, growth_5yr_pct: 6.0, notes: "Popular SW family suburb. Cashmere High zone." },
  { name: "Linwood", median_price: 440_000, median_rent_weekly: 490, rental_yield: 5.8, distance_cbd_km: 3, growth_5yr_pct: 4.0, notes: "Close to CBD, gentrifying fast. Character homes." },
  { name: "Woolston", median_price: 460_000, median_rent_weekly: 500, rental_yield: 5.6, distance_cbd_km: 4, growth_5yr_pct: 5.5, notes: "Inner-east, Ferry Rd cafes. Good value." },
  { name: "New Brighton", median_price: 450_000, median_rent_weekly: 480, rental_yield: 5.5, distance_cbd_km: 8, growth_5yr_pct: 9.0, notes: "Coastal regeneration (hot pools, new library). Values rising." },
  { name: "Bishopdale", median_price: 490_000, median_rent_weekly: 470, rental_yield: 4.9, distance_cbd_km: 6, growth_5yr_pct: 7.0, notes: "Established NW suburb. Near Nunweek Park." },
  { name: "Phillipstown", median_price: 430_000, median_rent_weekly: 480, rental_yield: 5.8, distance_cbd_km: 2, growth_5yr_pct: 3.0, notes: "Very central — 5 min to CBD. Strong rental demand." },
  { name: "Wainoni", median_price: 420_000, median_rent_weekly: 460, rental_yield: 5.7, distance_cbd_km: 6, growth_5yr_pct: 8.5, notes: "Affordable east. Near QEII Park." },
  { name: "Riccarton", median_price: 450_000, median_rent_weekly: 510, rental_yield: 5.4, distance_cbd_km: 4, growth_5yr_pct: 4.0, notes: "Student rental hotspot near UC. Strong yields." },
  { name: "Redwood", median_price: 460_000, median_rent_weekly: 470, rental_yield: 5.1, distance_cbd_km: 7, growth_5yr_pct: 6.5, notes: "Near Northlands Mall. Styx River walks." },
  { name: "Shirley", median_price: 470_000, median_rent_weekly: 460, rental_yield: 5.0, distance_cbd_km: 5, growth_5yr_pct: 5.0, notes: "Near The Palms. Good schools." },
  { name: "Burwood", median_price: 450_000, median_rent_weekly: 460, rental_yield: 5.3, distance_cbd_km: 7, growth_5yr_pct: 7.5, notes: "Eastern regeneration. Large sections." },
  { name: "Addington", median_price: 440_000, median_rent_weekly: 460, rental_yield: 5.3, distance_cbd_km: 2, growth_5yr_pct: 5.0, notes: "Walk to Hagley Park & hospital. Strong rentals." },
  { name: "Sydenham", median_price: 455_000, median_rent_weekly: 470, rental_yield: 5.2, distance_cbd_km: 2.5, growth_5yr_pct: 4.5, notes: "Central south. Colombo St shops." },
  { name: "Avonside", median_price: 420_000, median_rent_weekly: 440, rental_yield: 5.5, distance_cbd_km: 3.5, growth_5yr_pct: 6.0, notes: "Near Avon River. MRZ development potential." },
  { name: "Belfast", median_price: 480_000, median_rent_weekly: 470, rental_yield: 4.9, distance_cbd_km: 12, growth_5yr_pct: 8.0, notes: "Growing northern suburb. Near The Groynes." },
  { name: "Papanui", median_price: 490_000, median_rent_weekly: 480, rental_yield: 4.7, distance_cbd_km: 5, growth_5yr_pct: 5.0, notes: "Near Northlands Mall. Established area." },
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
