// Chart palette and formatting — the single source for every visual in the app.
//
// The categorical slots are assigned in fixed order and never cycled: a series
// keeps its colour when other series are filtered out, so "teal is what's left
// over" stays true everywhere it appears.
//
// Validated against the white card surface (all six checks pass, no warnings):
//   worst adjacent CVD ΔE 13.8, worst adjacent normal-vision ΔE 20.3,
//   every slot >= 3:1 contrast, every slot inside the lightness band.
// Re-run before changing a hex:
//   node scripts/validate_palette.js "<hex,...>" --mode light --surface "#ffffff"

/** Categorical identity. Assign in order — slot 1 first, never skip, never cycle. */
export const SERIES = [
  "#0d9488", // 1 teal (brand)
  "#ea580c", // 2 orange
  "#2563eb", // 3 blue
  "#d97706", // 4 amber
  "#db2777", // 5 pink
  "#6d28d9", // 6 violet
  "#e11d48", // 7 rose
] as const;

/**
 * State, never identity. Always shipped with an icon and a word, so the meaning
 * never rests on colour alone.
 */
export const STATUS = {
  good: "#0ca30c",
  warning: "#fab219",
  serious: "#ec835a",
  critical: "#d03b3b",
} as const;

export type StatusKey = keyof typeof STATUS;

/** Chart chrome. Gridlines and axes are solid hairlines, one step off the surface. */
export const INK = {
  surface: "#ffffff",
  grid: "#e2e8f0",
  axis: "#cbd5e1",
  primary: "#0f172a",
  secondary: "#475569",
  muted: "#94a3b8",
  /** The de-emphasis fill: context series, meter tracks, "everything else". */
  quiet: "#e2e8f0",
} as const;

/** Fills are a wash, not a block — the mark reads, the area recedes. */
export const AREA_OPACITY = 0.12;
/** White doing the separating, between stacked segments and adjacent bars alike. */
export const SURFACE_GAP_PX = 2;

export const AXIS_TICK = { fontSize: 11, fill: INK.muted } as const;

// --------------------------------------------------------------------------- //
// Money formatting — beginners read "$1.2k", not "$1,204.37"
// --------------------------------------------------------------------------- //
const NZD = new Intl.NumberFormat("en-NZ", {
  style: "currency",
  currency: "NZD",
  maximumFractionDigits: 0,
});

export const money = (n?: number | null) => (n == null ? "—" : NZD.format(n));

/** Axis-scale money: $450k, $1.2m. Keeps tick labels short enough to stay level. */
export function compactMoney(n?: number | null): string {
  if (n == null) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}m`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}k`;
  return `${sign}$${Math.round(abs)}`;
}

/** "$120/wk" with an explicit sign, for numbers that can go either way. */
export function signedWeekly(n: number): string {
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${money(Math.abs(Math.round(n)))}/wk`;
}

/** Years as a phrase a beginner reads without decoding: "6 years", "18 months". */
export function years(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n < 1) return `${Math.round(n * 12)} months`;
  if (n === 1) return "1 year";
  return `${Math.round(n * 10) / 10} years`;
}
