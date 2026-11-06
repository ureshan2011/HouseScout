// The optional townhouse shortlist: a garaged townhouse under a price cap, new builds
// by default. Listings carry no year-built field, so "new" is read from the listing
// text — a heuristic, and the UI says so. Pure and React-free so it can be unit-tested.

export type TownhouseCandidate = {
  property_type?: string | null;
  has_garage?: boolean | null;
  car_spaces?: number | null;
  price?: number | null;
  price_estimate?: number | null;
  description?: string | null;
  title?: string | null;
  price_text?: string | null;
};

export type TownhouseBrief = { maxPrice: number; newOnly: boolean };

// Phrases agents use for new stock. Deliberately conservative: "modern" or "renovated"
// alone do not count, and "as new" / "like new" describe condition, not a build.
const NEW_BUILD = [
  /\bnew\s*-?\s*build/i,
  /\bnewly\s+(built|constructed|completed)/i,
  /\bbrand[\s-]*new\b/i,
  /\bnew\s+(townhouse|home|development|release|stage)/i,
  /\bbuilt\s+(in\s+)?(20(2[4-9]|3\d))\b/i,
  /\b(completed|completion)\s+(in\s+)?(20(2[4-9]|3\d)|early|mid|late|q[1-4])/i,
  /\b(off[\s-]*the[\s-]*plans?|to\s+be\s+built|under\s+construction|titles?\s+(issued|due))\b/i,
  /\b10[\s-]*year\s+(build|builder)\s*(warranty|guarantee)\b/i,
  /\bnever\s+(been\s+)?(lived|occupied)\b/i,
];

export function looksNewBuild(l: TownhouseCandidate): boolean {
  const text = `${l.title ?? ""} ${l.description ?? ""}`;
  return NEW_BUILD.some((re) => re.test(text));
}

export function hasGarage(l: TownhouseCandidate): boolean {
  return l.has_garage === true || (l.car_spaces ?? 0) > 0 && l.has_garage !== false;
}

export function isTownhouse(l: TownhouseCandidate): boolean {
  return (l.property_type ?? "").toLowerCase() === "townhouse";
}

/** Does this listing belong on the townhouse shortlist? Unknown price never qualifies. */
export function fitsTownhouseBrief(l: TownhouseCandidate, brief: TownhouseBrief): boolean {
  if (!isTownhouse(l) || !hasGarage(l)) return false;
  const price = l.price ?? l.price_estimate ?? null;
  if (price == null || price > brief.maxPrice) return false;
  return !brief.newOnly || looksNewBuild(l);
}

export function townhouseShortlist<T extends TownhouseCandidate>(rows: T[], brief: TownhouseBrief): T[] {
  const price = (x: T) => x.price ?? x.price_estimate ?? Infinity;
  return rows.filter((r) => fitsTownhouseBrief(r, brief)).sort((a, b) => price(a) - price(b));
}
