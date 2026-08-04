"use client";

import { useId, useState } from "react";
import { INK, SERIES, STATUS, StatusKey, money, signedWeekly } from "@/lib/viz";

// Small visual pieces built in plain HTML rather than a charting library, so the
// 2px surface gaps, direct labels and hit targets are exactly to spec.

// --------------------------------------------------------------------------- //
// Glossary term
// --------------------------------------------------------------------------- //
const GLOSSARY: Record<string, string> = {
  LVR: "Loan to value ratio — your loan as a share of what the house is worth. A $400k loan on a $500k house is 80% LVR.",
  DTI: "Debt to income — your total debt divided by your yearly income before tax. Banks cap it at 6x for your own home, 7x for a rental.",
  equity: "The slice of the house you own outright: what it's worth, minus what you owe.",
  "releasable equity":
    "The part of your equity a bank will actually lend back to you — up to 80% of the value, minus the loan. Always less than the equity you own.",
  "interest-only":
    "You pay only the interest, so the loan never shrinks. Payments drop now; you own no more of the house later.",
  "P&I": "Principal and interest — the normal repayment. Part pays the interest, part shrinks the loan.",
  "ring-fenced":
    "A rental that loses money can't reduce the tax on your salary. The loss waits and offsets future rental income instead.",
  "bright-line":
    "Sell a rental within 2 years of buying it and the profit is taxed as income.",
  servicing:
    "The bank's affordability test. It checks the repayments at a rate about 2 points higher than the one you're offered.",
  yield: "A year of rent as a percentage of the price. $600/wk on a $500k house is 6.2%.",
  vacancy: "Weeks in the year with no tenant and no rent. Three is a normal allowance.",
  boarder:
    "Someone renting a room in the home you live in. Up to $245/wk each from up to 4 boarders is tax-free.",
};

/** Underlined jargon that explains itself on hover, focus or tap. */
export function Term({ k, children }: { k: keyof typeof GLOSSARY | string; children?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const text = GLOSSARY[k];
  if (!text) return <>{children ?? k}</>;
  return (
    <span className="relative inline-block">
      <button
        type="button"
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="cursor-help border-b border-dotted border-slate-400 font-medium text-slate-700 hover:border-slate-600 hover:text-slate-900"
      >
        {children ?? k}
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="absolute bottom-full left-0 z-20 mb-1.5 block w-64 rounded-lg bg-slate-900 px-3 py-2 text-xs font-normal leading-snug text-white shadow-lg"
        >
          {text}
        </span>
      )}
    </span>
  );
}

// --------------------------------------------------------------------------- //
// Table view — the relief channel every chart carries
// --------------------------------------------------------------------------- //
export function TableView({
  rows,
  caption,
}: {
  rows: { label: string; value: string }[];
  caption?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs font-medium text-slate-500 underline decoration-dotted hover:text-slate-800"
      >
        {open ? "Hide the numbers" : "Show the numbers"}
      </button>
      {open && (
        <table className="mt-2 w-full text-xs">
          {caption && <caption className="sr-only">{caption}</caption>}
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-t border-slate-100">
                <th scope="row" className="py-1 pr-3 text-left font-normal text-slate-600">
                  {r.label}
                </th>
                <td className="py-1 text-right font-medium tabular-nums text-slate-900">{r.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------- //
// Money bar — where each week's money actually goes
// --------------------------------------------------------------------------- //
export type MoneySegment = { label: string; weekly: number; hint?: string };

/**
 * One week of money as a single horizontal bar: income in, split into where it
 * goes, with anything left over on the end.
 *
 * The form beginners understand without a key — it is a pay packet, drawn.
 * Segments are separated by a 2px surface gap rather than a stroke, and any
 * segment too narrow for its label drops to the legend and the table instead of
 * clipping the text.
 */
export function MoneyBar({
  income,
  incomeLabel,
  segments,
  leftOver,
}: {
  income: number;
  incomeLabel: string;
  segments: MoneySegment[];
  /** What remains (or, when negative, what you top up from your own pocket). */
  leftOver: number;
}) {
  const spend = segments.reduce((s, x) => s + Math.max(0, x.weekly), 0);
  // A shortfall is drawn on the same scale as the money that caused it, so a bar
  // that runs past the income reads as "this costs more than it earns".
  const total = Math.max(income, spend);
  const shown = [
    ...segments.map((s, i) => ({ ...s, color: SERIES[i % SERIES.length] })),
    ...(leftOver > 0 ? [{ label: "Left over", weekly: leftOver, hint: undefined, color: STATUS.good }] : []),
  ].filter((s) => s.weekly > 0.5);

  const pct = (v: number) => (total > 0 ? (v / total) * 100 : 0);

  // With nothing coming in there is no income to measure the costs against, so
  // the bar is labelled as what it is: a bill, paid out of your wages.
  const noIncome = income < 1;

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-xs text-slate-500">{noIncome ? "Nothing coming in" : incomeLabel}</span>
        <span className="text-sm font-semibold tabular-nums text-slate-900">
          {noIncome ? `${money(spend)}/wk to pay` : `${money(income)}/wk in`}
        </span>
      </div>

      <div className="relative">
        <div
          className="flex h-7 w-full overflow-hidden rounded-md bg-slate-100"
          role="img"
          aria-label={`${noIncome ? "No income" : `${incomeLabel} ${money(income)} per week`}, spent on ${shown
            .map((s) => `${s.label} ${money(s.weekly)}`)
            .join(", ")}`}
        >
          {shown.map((s, i) => (
            <div
              key={s.label}
              title={`${s.label}: ${money(s.weekly)}/wk`}
              className="flex h-full items-center justify-center overflow-hidden"
              style={{
                width: `${pct(s.weekly)}%`,
                background: s.color,
                // The surface gap, not a border: white does the separating.
                marginLeft: i === 0 ? 0 : 2,
              }}
            >
              {/* Only label inside the segment when the text genuinely fits. */}
              {pct(s.weekly) > 18 && (
                <span className="px-1 text-[10px] font-semibold text-white">{money(s.weekly)}</span>
              )}
            </div>
          ))}
        </div>
        {/* Where the money coming in runs out. Without this the bar just looks
            full and the shortfall is invisible. The label is anchored to the
            marker, not to the container, so the arrow points at the right spot. */}
        {!noIncome && spend > income && (
          <>
            <span
              aria-hidden
              className="absolute -top-1 bottom-[-2px] w-0.5 bg-slate-900"
              style={{ left: `${pct(income)}%` }}
            />
            <span
              className="absolute top-[calc(100%+4px)] whitespace-nowrap text-[11px] text-slate-500"
              style={{
                // Past three-quarters along there is no room to centre the label,
                // so it hangs to the left of the marker instead of overflowing.
                left: pct(income) > 75 ? undefined : `${pct(income)}%`,
                right: pct(income) > 75 ? `${100 - pct(income)}%` : undefined,
                transform: pct(income) > 75 ? "none" : "translateX(-50%)",
                paddingRight: pct(income) > 75 ? "6px" : undefined,
              }}
            >
              {pct(income) > 75 ? `${money(income)} in ↑` : `↑ ${money(income)} in`}
            </span>
          </>
        )}
      </div>
      {!noIncome && spend > income && <div className="h-4" aria-hidden />}

      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {shown.map((s) => (
          <li key={s.label} className="flex items-center gap-1.5 text-xs text-slate-600">
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ background: s.color }}
            />
            {s.label}
            <span className="font-medium tabular-nums text-slate-900">{money(s.weekly)}</span>
          </li>
        ))}
      </ul>

      {leftOver < 0 && (
        <p className="mt-2 flex items-start gap-1.5 rounded-md bg-rose-50 px-2 py-1.5 text-xs text-rose-900">
          <span aria-hidden>⚠</span>
          <span>
            {noIncome
              ? `All ${money(Math.abs(leftOver))}/wk of it comes out of your wages.`
              : `Costs ${money(Math.abs(leftOver))}/wk more than it earns — that comes out of your wages.`}
          </span>
        </p>
      )}

      <TableView
        caption="Weekly money"
        rows={[
          { label: noIncome ? "Nothing coming in" : incomeLabel, value: `${money(income)}/wk` },
          ...segments.map((s) => ({ label: s.label, value: `−${money(s.weekly)}/wk` })),
          { label: leftOver >= 0 ? "Left over" : "You top up", value: signedWeekly(leftOver) },
        ]}
      />
    </div>
  );
}

// --------------------------------------------------------------------------- //
// Meter — one ratio against a limit
// --------------------------------------------------------------------------- //
const STATUS_ICON: Record<StatusKey, string> = {
  good: "✓",
  warning: "!",
  serious: "!",
  critical: "✕",
};

/**
 * A single value against a limit, with the limit drawn on the track.
 *
 * The fill carries severity and always ships with an icon and a word, so the
 * state never rests on colour alone.
 */
export function Meter({
  label,
  value,
  max,
  limit,
  limitLabel,
  display,
  status,
  statusText,
  hint,
}: {
  label: string;
  value: number;
  max: number;
  /** Where the line sits that you don't want to cross. */
  limit?: number;
  limitLabel?: string;
  /** Formatted value shown as the headline, e.g. "89.6%". */
  display: string;
  status: StatusKey;
  statusText: string;
  hint?: React.ReactNode;
}) {
  const clamp = (v: number) => Math.max(0, Math.min(100, (v / max) * 100));
  // A value at or past the bad end fills the track rather than emptying it: an
  // empty bar reads as "no data", not as "you have run out of room".
  const fill = status === "critical" && value <= 0 ? 100 : clamp(value);
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-xs text-slate-500">{label}</span>
        <span className="text-lg font-semibold text-slate-900">{display}</span>
      </div>
      <div className="relative h-2.5 w-full overflow-hidden rounded-full" style={{ background: INK.quiet }}>
        <div
          className="h-full rounded-full transition-[width]"
          style={{ width: `${fill}%`, background: STATUS[status] }}
        />
        {limit != null && limit < max && (
          <span
            aria-hidden
            className="absolute top-0 h-full w-0.5 bg-slate-900/50"
            style={{ left: `${clamp(limit)}%` }}
          />
        )}
      </div>
      <p className="mt-1.5 flex items-start gap-1.5 text-xs">
        <span
          aria-hidden
          className="mt-px inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
          style={{ background: STATUS[status] }}
        >
          {STATUS_ICON[status]}
        </span>
        <span className="text-slate-600">
          <span className="font-medium text-slate-800">{statusText}</span>
          {limitLabel && <> · {limitLabel}</>}
        </span>
      </p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

// --------------------------------------------------------------------------- //
// Milestones — the plan as a road, not a table
// --------------------------------------------------------------------------- //
export type Milestone = {
  year: number | null;
  label: string;
  detail?: string;
  reached: boolean;
};

/**
 * A horizontal road of dated events: buy, equity ready, mortgage-free.
 *
 * Each marker sits at its real position on the horizon — year 8 of 15 lands at
 * 53% along. Spacing them evenly would draw a timeline that lies about timing.
 */
export function Milestones({ items, horizon }: { items: Milestone[]; horizon: number }) {
  const placed = (items.filter((m) => m.year != null) as (Milestone & { year: number })[]).sort(
    (a, b) => a.year - b.year,
  );
  const missed = items.filter((m) => m.year == null);
  const at = (year: number) => Math.max(0, Math.min(100, (year / Math.max(1, horizon)) * 100));
  // Drop a label to a second row only when it would actually collide with the
  // one before it — an unprompted stagger reads as a hierarchy that isn't there.
  const staggered = placed.map(
    (m, i) => i > 0 && at(m.year) - at(placed[i - 1].year) < 24 && !stagger(placed, i - 1),
  );
  function stagger(list: typeof placed, i: number): boolean {
    return i > 0 && at(list[i].year) - at(list[i - 1].year) < 24;
  }

  return (
    <div>
      <div className="relative pb-1 pt-1">
        <div className="absolute left-0 right-0 top-2.5 h-0.5" style={{ background: INK.quiet }} />
        {/* Year ticks, so the marker positions are readable as time. */}
        {[0, 0.5, 1].map((t) => (
          <span
            key={t}
            aria-hidden
            className="absolute top-1 h-2 w-px"
            style={{ left: `${t * 100}%`, background: INK.axis }}
          />
        ))}
        <ol className={`relative ${staggered.some(Boolean) ? "h-28" : "h-16"}`}>
          {placed.map((m, i) => {
            const left = at(m.year);
            // Markers near an edge anchor to it so their labels stay on the card.
            const anchor = left < 15 ? "left" : left > 85 ? "right" : "center";
            return (
              <li
                key={m.label}
                className="absolute top-0 w-32"
                style={{
                  left: anchor === "right" ? undefined : `${left}%`,
                  right: anchor === "right" ? `${100 - left}%` : undefined,
                  transform: anchor === "center" ? "translateX(-50%)" : undefined,
                  textAlign: anchor === "right" ? "right" : anchor === "left" ? "left" : "center",
                  paddingTop: staggered[i] ? "3.25rem" : "0",
                }}
              >
                <span
                  aria-hidden
                  className="absolute h-3 w-3 rounded-full ring-2 ring-white"
                  style={{
                    top: "0.25rem",
                    left: anchor === "left" ? 0 : anchor === "right" ? undefined : "50%",
                    right: anchor === "right" ? 0 : undefined,
                    transform: anchor === "center" ? "translateX(-50%)" : undefined,
                    background: m.reached ? SERIES[0] : INK.muted,
                  }}
                />
                <span
                  className="absolute h-full w-px"
                  aria-hidden
                  style={{
                    top: "0.25rem",
                    height: staggered[i] ? "3rem" : 0,
                    left: anchor === "left" ? "5px" : anchor === "right" ? undefined : "50%",
                    right: anchor === "right" ? "5px" : undefined,
                    background: INK.quiet,
                  }}
                />
                <span className="mt-4 block text-xs font-semibold text-slate-900">
                  {m.year === 0 ? "Now" : `Year ${m.year}`}
                </span>
                <span className="block text-xs leading-tight text-slate-600">{m.label}</span>
                {m.detail && (
                  <span className="block text-[11px] leading-tight text-slate-400">{m.detail}</span>
                )}
              </li>
            );
          })}
        </ol>
        <p className="text-right text-[11px] text-slate-400">over {horizon} years</p>
      </div>
      {missed.length > 0 && (
        <ul className="mt-2 space-y-1">
          {missed.map((m) => (
            <li key={m.label} className="flex items-start gap-1.5 text-xs text-slate-500">
              <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
              <span>
                <span className="font-medium text-slate-600">{m.label}</span>
                {m.detail ? ` — ${m.detail}` : " — doesn't happen inside this window."}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------- //
// Verdict chip — the one-word answer, always with a word and an icon
// --------------------------------------------------------------------------- //
export function Verdict({ status, children }: { status: StatusKey; children: React.ReactNode }) {
  const bg: Record<StatusKey, string> = {
    good: "bg-emerald-50 text-emerald-900",
    warning: "bg-amber-50 text-amber-900",
    serious: "bg-orange-50 text-orange-900",
    critical: "bg-rose-50 text-rose-900",
  };
  return (
    <span className={`badge gap-1 ${bg[status]}`}>
      <span
        aria-hidden
        className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-[9px] font-bold text-white"
        style={{ background: STATUS[status] }}
      >
        {STATUS_ICON[status]}
      </span>
      {children}
    </span>
  );
}
