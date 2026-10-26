// Pure helpers behind the home dashboard: how a house is being sold, when a sale
// closes, price bands against the buyer's budget, and per-suburb roll-ups.
//
// Kept free of React and of the Listing/Prediction types' full surface (structural
// `Pick`s only) so the arithmetic can be unit-tested with plain objects — the same
// split as finance.ts and strategy.ts.

export type SaleMethod = "published" | "auction" | "deadline" | "negotiation";

type Priced = {
  price?: number | null;
  price_estimate?: number | null;
  price_text?: string | null;
  data_quality?: "observed" | "estimated" | null;
};

/**
 * How the vendor is selling. Auction and deadline are checked first because the tile
 * text for those can still carry a number ("Auction — viewed from $450,000").
 */
export function saleMethod(l: Priced): SaleMethod {
  const t = (l.price_text ?? "").toLowerCase();
  if (/auction/.test(t)) return "auction";
  if (/deadline|tender/.test(t)) return "deadline";
  if (l.price != null && l.data_quality !== "estimated") return "published";
  return "negotiation"; // by negotiation, POA, enquiries with no figure, or unstated
}

export const SALE_LABEL: Record<SaleMethod, string> = {
  published: "Price published",
  auction: "Auction",
  deadline: "Deadline sale",
  negotiation: "By negotiation",
};

/** The price to plot: published if there is one, otherwise the model's estimate. */
export function effectivePrice(l: Priced): number | null {
  return l.price ?? l.price_estimate ?? null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DATE_RE = /(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;

/**
 * When an auction or deadline sale closes, parsed from the tile text ("Deadline sale by
 * 12 Nov", "Auction on 11 Nov, 6:00 pm"). The text carries no year, so take whichever
 * year puts the date nearest to today: a 5 Jan date seen on 20 Dec is next January, and
 * a 19 Dec date seen on 5 Jan is the one that has just passed (the caller drops it).
 */
export function closingDate(l: Priced, today: Date): Date | null {
  if (saleMethod(l) !== "auction" && saleMethod(l) !== "deadline") return null;
  const m = DATE_RE.exec(l.price_text ?? "");
  if (!m) return null;
  const month = MONTHS.indexOf(m[2].toLowerCase());
  const day = Number(m[1]);
  const y = today.getFullYear();
  if (new Date(y, month, day).getMonth() !== month) return null; // 31 Feb and friends
  const start = new Date(y, today.getMonth(), today.getDate()).getTime();
  return [y - 1, y, y + 1]
    .map((yr) => new Date(yr, month, day))
    .reduce((best, d) => (Math.abs(d.getTime() - start) < Math.abs(best.getTime() - start) ? d : best));
}

/** Whole days from `today` to `d` (0 = today). */
export function daysUntil(d: Date, today: Date): number {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((d.getTime() - start.getTime()) / 86_400_000);
}

export function closesLabel(days: number): string {
  if (days < 0) return "closed";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

// --------------------------------------------------------------------------- //
// Price bands
// --------------------------------------------------------------------------- //
export type Band = {
  label: string;
  lo: number;
  hi: number;
  count: number;
  /** Entirely under the budget / straddling it / entirely over. */
  fit: "within" | "stretch" | "over";
};

const EDGES = [0, 300_000, 400_000, 500_000, 600_000, 700_000, 800_000, 1_000_000, Infinity];

function bandLabel(lo: number, hi: number): string {
  const k = (n: number) => `${Math.round(n / 1000)}k`;
  if (lo === 0) return `<$${k(hi)}`;
  if (!Number.isFinite(hi)) return `$${lo >= 1_000_000 ? `${lo / 1_000_000}m` : k(lo)}+`;
  if (hi >= 1_000_000) return `$${k(lo)}–${hi / 1_000_000}m`;
  return `$${k(lo)}–${k(hi)}`;
}

/** Counts per price band, tagged against the buyer's budget. Every price lands in exactly one band. */
export function priceBands(prices: number[], budget: number): Band[] {
  return EDGES.slice(0, -1).map((lo, i) => {
    const hi = EDGES[i + 1];
    const count = prices.filter((p) => p >= lo && p < hi).length;
    const fit: Band["fit"] = hi <= budget ? "within" : lo < budget ? "stretch" : "over";
    return { label: bandLabel(lo, hi), lo, hi, count, fit };
  });
}

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// --------------------------------------------------------------------------- //
// Suburbs
// --------------------------------------------------------------------------- //
export type SuburbRow = {
  suburb: string;
  count: number;
  medianPrice: number | null;
  avgDeal: number;
  avgYield: number;
};

type SuburbInput = { suburb?: string | null; price: number | null; deal: number; yieldPct: number };

/**
 * Per-suburb roll-up, best average deal first. Suburbs with fewer than `minCount`
 * listings are dropped: an "average" of one house is an anecdote, and ranking suburbs
 * by it would put whichever single listing happened to score highest on top.
 */
export function suburbRows(items: SuburbInput[], minCount = 3): SuburbRow[] {
  const groups = new Map<string, SuburbInput[]>();
  for (const it of items) {
    if (!it.suburb) continue;
    groups.set(it.suburb, [...(groups.get(it.suburb) ?? []), it]);
  }
  const rows: SuburbRow[] = [];
  for (const [suburb, g] of groups) {
    if (g.length < minCount) continue;
    rows.push({
      suburb,
      count: g.length,
      medianPrice: median(g.map((x) => x.price).filter((p): p is number => p != null)),
      avgDeal: g.reduce((s, x) => s + x.deal, 0) / g.length,
      avgYield: g.reduce((s, x) => s + x.yieldPct, 0) / g.length,
    });
  }
  return rows.sort((a, b) => b.avgDeal - a.avgDeal);
}
