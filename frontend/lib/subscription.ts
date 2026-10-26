// Subscription tiers and feature entitlements.
//
// NOT A BILLING SYSTEM. The site is static, so all gating here is client-side —
// a UX mechanism, not a security boundary. Before charging real money: take
// payment through Stripe/Paddle, return the tier from an authenticated endpoint,
// and gate the *data* rather than the UI. `resolveEntitlement()` is the one seam
// to swap; every `<Gate>` in the app follows it.

export type Tier = "free" | "pro" | "investor";

export const TIER_ORDER: Record<Tier, number> = { free: 0, pro: 1, investor: 2 };

/**
 * The tier every visitor gets without paying or holding a licence.
 *
 * `"free"` is the normal paywall. Set to `"pro"` and Buyer Pro is open to everyone —
 * every `<Gate>` and `useFeature` follows, because both resolve through
 * `effectiveTier()` below. Set back to `"free"` to restore the paywall; nothing else
 * needs to change. A stored licence can only raise a visitor above this, never below.
 */
export const COMPLIMENTARY_TIER: Tier = "pro";

/** A tier is included free when it sits at or below the complimentary baseline. */
export function isComplimentary(tier: Tier): boolean {
  return TIER_ORDER[tier] <= TIER_ORDER[COMPLIMENTARY_TIER];
}

/** The tier actually in force: the higher of what the visitor holds and the baseline. */
export function effectiveTier(held: Tier): Tier {
  return TIER_ORDER[held] >= TIER_ORDER[COMPLIMENTARY_TIER] ? held : COMPLIMENTARY_TIER;
}

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
  | "strategyLab"        // compare buy-and-hold / refinance / payoff strategies
  | "portfolioPlan"      // multi-property equity-recycling projection
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
  strategyLab: "pro",
  portfolioPlan: "investor",
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
      "Borrowing capacity: deposit, DTI and servicing",
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
      "Strategy Lab — payoff vs hold vs refinance",
      "Equity timeline: when you can buy again",
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
      "Interest-rate and vacancy stress testing",
      "Portfolio plan — equity recycling year by year",
      "What blocks the next purchase: equity, DTI or servicing",
      "Break-even rate and rent on every hold",
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

/** Licence keys are `HS-<TIER>-<TOKEN>`, e.g. `HS-PRO-8FJ2K1`. */
export function tierFromLicence(licence: string): Tier | null {
  const m = /^HS-(FREE|PRO|INVESTOR)-[A-Z0-9]{4,}$/i.exec(licence.trim());
  if (!m) return null;
  return m[1].toLowerCase() as Tier;
}

export function getTier(): Tier {
  if (typeof window === "undefined") return effectiveTier("free");
  const stored = localStorage.getItem(LS_TIER);
  if (stored === "pro" || stored === "investor" || stored === "free") return effectiveTier(stored);
  return effectiveTier("free");
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
 * The single seam to swap for real server-side entitlement. Reads the stored tier
 * and honours `?licence=`, so a checkout can redirect back with the purchased tier.
 */
export async function resolveEntitlement(): Promise<Tier> {
  if (typeof window === "undefined") return effectiveTier("free");
  const param = new URLSearchParams(window.location.search).get("licence");
  if (param) {
    const granted = applyLicence(param);
    if (granted) return effectiveTier(granted);
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
