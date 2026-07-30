// Subscription tiers and feature entitlements.
//
// HOW ENFORCEMENT WORKS — read this before relying on it commercially
// -------------------------------------------------------------------
// HouseScout ships as a static site (GitHub Pages), so there is no server in the
// request path and *all* gating here is client-side. Client-side gating is a
// product/UX mechanism, not a security boundary: a determined user can unlock every
// tier from the browser console, and the underlying data is in `listings.json`
// anyway.
//
// That is a deliberate, acceptable trade-off for launch — it lets the paywall,
// pricing and upgrade flows be built and tested now — but it is NOT a billing
// system. Before charging real money the entitlement check must move server-side:
//
//   1. Stripe Checkout (or Paddle) for payment; webhook writes the subscription.
//   2. A small API (`/api/entitlement`) that returns the tier for a signed-in user.
//   3. Gate the *data*, not just the UI: serve Pro fields (valuation, forecasts,
//      Deal Radar) from an authenticated endpoint rather than the public JSON.
//
// `resolveEntitlement()` is the single seam for that change — swap its body for a
// fetch against the real API and every `<Gate>` in the app follows.

export type Tier = "free" | "pro" | "investor";

export const TIER_ORDER: Record<Tier, number> = { free: 0, pro: 1, investor: 2 };

export type Feature =
  | "valuation"          // modelled fair value + confidence band
  | "pricePosition"      // asking vs modelled value
  | "growthForecast"     // 10-year capital growth projection
  | "negotiation"        // negotiation room + target offer
  | "dealRadar"          // ranked underpriced opportunities across the market
  | "watchlist"          // save and compare properties
  | "compare"            // side-by-side comparison
  | "csvExport"          // export matches to CSV
  | "printReport"        // print/PDF property report
  | "rateStress"         // interest-rate stress testing
  | "unlimitedListings"; // browse past the free-tier cap

/** Which tier each feature unlocks at. */
export const FEATURE_TIER: Record<Feature, Tier> = {
  valuation: "pro",
  pricePosition: "pro",
  growthForecast: "pro",
  negotiation: "pro",
  dealRadar: "pro",
  watchlist: "pro",
  compare: "pro",
  csvExport: "pro",
  printReport: "pro",
  rateStress: "investor",
  unlimitedListings: "pro",
};

/** How many listings the free tier can browse before the upgrade prompt. */
export const FREE_LISTING_LIMIT = 12;

export type Plan = {
  tier: Tier;
  name: string;
  priceMonthly: number;
  tagline: string;
  features: string[];
  cta: string;
};

export const PLANS: Plan[] = [
  {
    tier: "free",
    name: "Scout",
    priceMonthly: 0,
    tagline: "See what's on the market and whether it fits your brief.",
    features: [
      `Browse ${FREE_LISTING_LIMIT} top matches`,
      "Match score against your criteria",
      "Mortgage & boarder-income calculator",
      "Accelerated payoff simulator",
      "Suburb affordability table",
      "Buyer guide & NZ tax rules",
    ],
    cta: "Current plan",
  },
  {
    tier: "pro",
    name: "Buyer Pro",
    priceMonthly: 19,
    tagline: "Know what it's worth and what to offer, before you call the agent.",
    features: [
      "Everything in Scout, unlimited listings",
      "Modelled fair value with confidence band",
      "Over/under-priced vs the model",
      "Negotiation room & target offer price",
      "10-year capital growth forecast",
      "Deal Radar — market-wide bargains ranked",
      "Watchlist & side-by-side compare",
      "CSV export and printable reports",
    ],
    cta: "Upgrade to Pro",
  },
  {
    tier: "investor",
    name: "Investor",
    priceMonthly: 49,
    tagline: "Stress-test the plan and model the whole portfolio.",
    features: [
      "Everything in Buyer Pro",
      "Interest-rate stress testing",
      "Multi-property portfolio modelling",
      "Equity & net-worth projections",
      "Break-even and worst-case analysis",
      "Priority access to new models",
    ],
    cta: "Upgrade to Investor",
  },
];

// --------------------------------------------------------------------------- //
// Entitlement resolution
// --------------------------------------------------------------------------- //
const LS_TIER = "housescout.tier";
const LS_LICENCE = "housescout.licence";

/**
 * Licence keys are `HS-<TIER>-<TOKEN>`, e.g. `HS-PRO-8FJ2K1`.
 *
 * The format is intentionally simple because verifying it in the browser proves
 * nothing (see the module header) — it exists so the upgrade flow is real and
 * testable end-to-end, and so the seam for server-verified licences already exists.
 */
export function tierFromLicence(licence: string): Tier | null {
  const m = /^HS-(FREE|PRO|INVESTOR)-[A-Z0-9]{4,}$/i.exec(licence.trim());
  if (!m) return null;
  return m[1].toLowerCase() as Tier;
}

export function getTier(): Tier {
  if (typeof window === "undefined") return "free";
  const stored = localStorage.getItem(LS_TIER);
  if (stored === "pro" || stored === "investor" || stored === "free") return stored;
  return "free";
}

export function setTier(tier: Tier): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(LS_TIER, tier);
  window.dispatchEvent(new Event("housescout:tier"));
}

export function getLicence(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(LS_LICENCE) || "";
}

/** Apply a licence key. Returns the tier granted, or null if the key is malformed. */
export function applyLicence(licence: string): Tier | null {
  const tier = tierFromLicence(licence);
  if (!tier) return null;
  if (typeof window !== "undefined") localStorage.setItem(LS_LICENCE, licence.trim());
  setTier(tier);
  return tier;
}

export function clearLicence(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(LS_LICENCE);
  setTier("free");
}

/**
 * The single seam to swap for real server-side entitlement.
 *
 * Today: reads the locally stored tier, and honours a `?licence=` query parameter
 * so a checkout provider can redirect back into the app with the purchased tier.
 * Tomorrow: `return (await fetch("/api/entitlement")).json()`.
 */
export async function resolveEntitlement(): Promise<Tier> {
  if (typeof window === "undefined") return "free";
  const param = new URLSearchParams(window.location.search).get("licence");
  if (param) {
    const granted = applyLicence(param);
    if (granted) return granted;
  }
  return getTier();
}

export function hasFeature(tier: Tier, feature: Feature): boolean {
  return TIER_ORDER[tier] >= TIER_ORDER[FEATURE_TIER[feature]];
}

export function planFor(tier: Tier): Plan {
  return PLANS.find((p) => p.tier === tier) ?? PLANS[0];
}

/** The cheapest plan that unlocks a feature — what the upgrade prompt should offer. */
export function requiredPlan(feature: Feature): Plan {
  return planFor(FEATURE_TIER[feature]);
}
