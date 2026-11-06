// The buyer's profile — stored per-browser and applied at scoring time, so the
// budget, deposit and rate that drive every score are a form field rather than a
// build-time constant. FACTORY_DEFAULTS is what an untouched browser gets.

const STORAGE_KEY = "housescout.profile.v1";

export type BuyerProfile = {
  /** Hard ceiling: listings above this fail the filters. */
  max_price: number;
  /** What the bank has agreed to lend + deposit. Drives the affordability headroom. */
  preapproval: number;
  deposit: number;
  annual_rate: number;
  term_years: number;
  /** Expected weekly rent per boarder room. */
  weekly_rent: number;
  require_garage: boolean;
  require_backyard: boolean;
  min_backyard_m2: number;
  allow_townhouse: boolean;
  /** Show a separate shortlist of townhouses on the homepage (see lib/townhouse.ts). */
  townhouse_option: boolean;
  /** Price ceiling for that shortlist. Independent of max_price. */
  townhouse_max_price: number;
  /** Only show townhouses whose listing text signals a new build. */
  townhouse_new_only: boolean;

  // --- Everything the strategy engine used to assume on the buyer's behalf --- //
  /** Household income before tax. Drives the DTI and servicing tests. */
  gross_income: number;
  /** Capital growth used by the Strategy Lab. Listings use their suburb's own rate. */
  growth_pct: number;
  marginal_tax_rate: number;
  rates_annual: number;
  insurance_annual: number;
  /** Annual maintenance as a share of the property's value. */
  maintenance_pct: number;
  /** Property-management fee as a share of rent. Zero if you manage it yourself. */
  management_pct: number;
  /** Weeks a year with no tenant. */
  vacancy_weeks: number;
  interest_only_years: number;
  /** How far the projections run. */
  horizon_years: number;
  /** Monthly living costs, used by the bank's affordability test. */
  living_costs_monthly: number;
};

/**
 * The values the app assumes until a buyer says otherwise.
 *
 * Set for a single buyer: Christchurch house-hack on a standalone freehold house with
 * land and a garage, living in it ~2 years then renting it out from Sri Lanka. Figures
 * are as at Nov 2026 (ANZ 1-yr fixed 4.99%, REINZ Christchurch median ~$715k; the
 * affordable stock with land sits in the $500-600k band).
 */
export const FACTORY_DEFAULTS: BuyerProfile = {
  max_price: 600_000,
  preapproval: 580_000,
  // 20% of a ~$575k house, from ~$140k cash after keeping a ~$25k emergency buffer.
  deposit: 115_000,
  annual_rate: 0.0499,
  term_years: 30,
  weekly_rent: 230,
  require_garage: true,
  require_backyard: true,
  // Land, not just a yard: the brief is a standalone house on a real section.
  min_backyard_m2: 300,
  // Standalone freehold only.
  allow_townhouse: false,
  // Optional second brief: new-build townhouse with a garage, under $400k. Off until asked for.
  townhouse_option: false,
  townhouse_max_price: 400_000,
  townhouse_new_only: true,
  // Lender-facing income: salaried income only. The second, contract income is left out
  // until it is extended, so borrowing capacity is not overstated.
  gross_income: 125_000,
  // Stress-tested well below recent run rates; the Christchurch median rose 2-4% in the year.
  growth_pct: 3.5,
  // Tax on rental profit is at the top rate once both incomes count.
  marginal_tax_rate: 0.39,
  rates_annual: 3_700,
  insurance_annual: 2_600,
  maintenance_pct: 0.01,
  // A property manager once the owner is overseas.
  management_pct: 0.08,
  vacancy_weeks: 3,
  interest_only_years: 5,
  horizon_years: 15,
  living_costs_monthly: 2_800,
};

// Bounds are sanity rails, not opinions: they stop a stray keystroke (or a stale
// stored value from an older schema) producing a scoring engine that divides by zero
// or ranks the entire market at 0.
const BOUNDS: Record<keyof BuyerProfile, [number, number] | null> = {
  max_price: [50_000, 10_000_000],
  preapproval: [0, 10_000_000],
  deposit: [0, 10_000_000],
  annual_rate: [0, 0.25],
  term_years: [1, 40],
  weekly_rent: [0, 2_000],
  min_backyard_m2: [0, 5_000],
  townhouse_max_price: [50_000, 10_000_000],
  gross_income: [0, 5_000_000],
  growth_pct: [-10, 20],
  marginal_tax_rate: [0, 0.6],
  rates_annual: [0, 50_000],
  insurance_annual: [0, 50_000],
  maintenance_pct: [0, 0.1],
  management_pct: [0, 0.2],
  vacancy_weeks: [0, 26],
  interest_only_years: [0, 15],
  horizon_years: [1, 40],
  living_costs_monthly: [0, 50_000],
  require_garage: null,
  require_backyard: null,
  allow_townhouse: null,
  townhouse_option: null,
  townhouse_new_only: null,
};

function coerce(input: Partial<BuyerProfile> | null | undefined): BuyerProfile {
  const out: BuyerProfile = { ...FACTORY_DEFAULTS };
  if (!input) return out;
  for (const key of Object.keys(FACTORY_DEFAULTS) as (keyof BuyerProfile)[]) {
    const value = input[key];
    if (value == null) continue;
    const bounds = BOUNDS[key];
    if (bounds === null) {
      if (typeof value === "boolean") (out[key] as boolean) = value;
      continue;
    }
    const n = Number(value);
    if (!Number.isFinite(n)) continue;
    (out[key] as number) = Math.min(bounds[1], Math.max(bounds[0], n));
  }
  return out;
}

let cached: BuyerProfile | null = null;
const listeners = new Set<(p: BuyerProfile) => void>();

/** The active profile. Falls back to FACTORY_DEFAULTS during SSR and static export. */
export function loadProfile(): BuyerProfile {
  if (cached) return cached;
  if (typeof window === "undefined") return { ...FACTORY_DEFAULTS };
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    cached = coerce(stored ? JSON.parse(stored) : null);
  } catch {
    cached = { ...FACTORY_DEFAULTS };
  }
  return cached;
}

export function saveProfile(patch: Partial<BuyerProfile>): BuyerProfile {
  const next = coerce({ ...loadProfile(), ...patch });
  cached = next;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Private browsing / storage disabled: the profile still applies for this
      // session, it just will not survive a reload. Not worth an error to the user.
    }
  }
  listeners.forEach((fn) => fn(next));
  return next;
}

export function resetProfile(): BuyerProfile {
  cached = { ...FACTORY_DEFAULTS };
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* see saveProfile */
    }
  }
  listeners.forEach((fn) => fn(cached!));
  return cached;
}

/** Notified whenever the profile changes, so scored views can recompute. */
export function onProfileChange(fn: (p: BuyerProfile) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Stable identity for the current profile — used to invalidate the scoring cache. */
export function profileSignature(p: BuyerProfile = loadProfile()): string {
  return (Object.keys(FACTORY_DEFAULTS) as (keyof BuyerProfile)[])
    .map((k) => `${k}=${p[k]}`)
    .join("&");
}

export function isDefault(p: BuyerProfile = loadProfile()): boolean {
  return profileSignature(p) === profileSignature(FACTORY_DEFAULTS);
}
