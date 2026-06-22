// Matching & scoring engine — a TypeScript port of backend/app/scoring.py.
//
// Encodes the buyer's brief:
//   * Hard filters: price <= cap, garage required, backyard required.
//   * Townhouses allowed but penalised.
//   * Rentability (rooms for boarders) is heavily weighted (pay the loan off fast).

import { rentableRooms } from "./finance";

export type Criteria = {
  max_price: number;
  preapproval: number;
  require_garage: boolean;
  require_backyard: boolean;
  min_backyard_m2: number;
  allow_townhouse: boolean;
};

export const defaultCriteria = (): Criteria => ({
  max_price: 500_000,
  preapproval: 480_000,
  require_garage: true,
  require_backyard: true,
  min_backyard_m2: 50.0, // "at least a tiny backyard"
  allow_townhouse: true,
});

// Component weights (sum = 100). Rentability dominates per the buyer's goal.
const WEIGHTS: Record<string, number> = {
  price: 20,
  garage: 10,
  backyard: 15,
  rentability: 30,
  property_type: 10,
  deal: 10,
  freshness: 5,
};

const PROPERTY_TYPE_SCORE: Record<string, number> = {
  house: 1.0,
  unit: 0.6,
  apartment: 0.5,
  townhouse: 0.45, // allowed but least preferred
};

// Minimal shape the scorer reads from a listing.
export type ScorableListing = {
  price?: number | null;
  bedrooms?: number | null;
  has_garage?: boolean | null;
  land_area_m2?: number | null;
  property_type?: string | null;
  days_on_market?: number | null;
  enrichment?: {
    land_area_m2?: number | null;
    estimate_value?: number | null;
    rateable_value?: number | null;
  } | null;
};

function backyardM2(listing: ScorableListing): number | null | undefined {
  // Best available land figure (LINZ enrichment preferred over listing field).
  const enr = listing.enrichment || {};
  return enr.land_area_m2 || listing.land_area_m2;
}

export function passesHardFilters(listing: ScorableListing, c: Criteria): [boolean, string[]] {
  const reasons: string[] = [];
  const price = listing.price;
  if (price != null && price > c.max_price) {
    reasons.push(`over budget ($${fmt(price)} > $${fmt(c.max_price)})`);
  }
  if (c.require_garage && !listing.has_garage) reasons.push("no garage");
  if (c.require_backyard) {
    const land = backyardM2(listing);
    const ptype = (listing.property_type || "").toLowerCase();
    // Apartments never have a yard; require land data to clear the filter otherwise.
    if (ptype === "apartment" || (land != null && land < c.min_backyard_m2)) {
      reasons.push("no/too-small backyard");
    }
  }
  if (!c.allow_townhouse && (listing.property_type || "").toLowerCase() === "townhouse") {
    reasons.push("townhouse excluded");
  }
  return [reasons.length === 0, reasons];
}

function clamp(x: number, lo = 0.0, hi = 1.0): number {
  return Math.max(lo, Math.min(hi, x));
}

function round3(x: number): number {
  return Math.round((x + Number.EPSILON) * 1000) / 1000;
}

function fmt(n: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
}

export type ScoreResult = {
  match_score: number;
  passes_filters: boolean;
  failed_filters: string[];
  components: Record<string, number>;
  rentable_rooms: number;
};

export function scoreListing(listing: ScorableListing, c: Criteria): ScoreResult {
  // Compute a 0-100 match score plus a component breakdown.
  const [passes, failed] = passesHardFilters(listing, c);
  const comp: Record<string, number> = {};

  // Price: reward headroom under the cap; 0 at/over cap.
  const price = listing.price;
  if (price) {
    comp.price = clamp((c.max_price - price) / Math.max(c.max_price - 250_000, 1));
  } else {
    comp.price = 0.3; // unknown (auction/negotiation) -> neutral-low
  }

  comp.garage = listing.has_garage ? 1.0 : 0.0;

  const land = backyardM2(listing);
  if (land) {
    // Scale 50 m2 -> 0.4, 600 m2 -> 1.0.
    comp.backyard = clamp(0.4 + ((land - 50) / 550) * 0.6);
  } else {
    comp.backyard = 0.2;
  }

  const rooms = rentableRooms(listing.bedrooms);
  comp.rentability = clamp(rooms / 4); // 4 boarders = full IRD allowance

  const ptype = (listing.property_type || "house").toLowerCase();
  comp.property_type = PROPERTY_TYPE_SCORE[ptype] ?? 0.5;

  // Deal: asking below estimate/RV is a good sign.
  const enr = listing.enrichment || {};
  const ref = enr.estimate_value || enr.rateable_value;
  if (price && ref) {
    comp.deal = clamp(0.5 + (ref - price) / ref);
  } else {
    comp.deal = 0.5;
  }

  // Freshness: newer listings score slightly higher.
  const days = listing.days_on_market;
  comp.freshness = clamp(1 - (days || 14) / 90);

  const total = Object.keys(WEIGHTS).reduce((acc, k) => acc + WEIGHTS[k] * comp[k], 0);
  const components: Record<string, number> = {};
  for (const k of Object.keys(comp)) components[k] = round3(comp[k]);

  return {
    match_score: Math.round(total * 10) / 10,
    passes_filters: passes,
    failed_filters: failed,
    components,
    rentable_rooms: rooms,
  };
}
