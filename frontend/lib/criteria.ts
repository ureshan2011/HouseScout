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
};

/** The values that were hardcoded before this file existed. */
export const FACTORY_DEFAULTS: BuyerProfile = {
  max_price: 500_000,
  preapproval: 480_000,
  deposit: 50_000,
  annual_rate: 0.0519,
  term_years: 30,
  weekly_rent: 220,
  require_garage: true,
  require_backyard: true,
  min_backyard_m2: 50,
  allow_townhouse: true,
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
  require_garage: null,
  require_backyard: null,
  allow_townhouse: null,
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
