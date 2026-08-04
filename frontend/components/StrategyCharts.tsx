"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { EquityYear, SimYear } from "@/lib/strategy";
import { AXIS_TICK, INK, SERIES, STATUS, compactMoney, money } from "@/lib/viz";

// Charts share one palette (lib/viz.ts) assigned in fixed slot order, so a colour
// always means the same thing across the app. Gridlines are solid hairlines, fills
// are separated by a 2px gap in the surface colour rather than by a stroke.

const GRID = { strokeDasharray: "0", stroke: INK.grid } as const;

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-semibold text-slate-900">Year {label}</p>
      {payload.map((e: any) => (
        <p key={e.name} className="flex items-center gap-2 text-slate-600">
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ background: e.color }}
          />
          {e.name}
          <span className="ml-auto font-medium tabular-nums text-slate-900">{money(e.value)}</span>
        </p>
      ))}
    </div>
  );
}

const legendStyle = { fontSize: 11, color: INK.secondary } as const;

/**
 * Debt, locked equity and releasable equity stacked to the property's value.
 *
 * Part-to-whole over time: the three bands always add up to what the house is
 * worth, so the reader sees the debt shrinking as a share, not just in dollars.
 */
export function EquityChart({ rows }: { rows: EquityYear[] }) {
  const data = rows.map((r) => ({
    year: r.year,
    "You owe": r.balance,
    "Yours, but locked in": Math.max(0, r.equity - r.usableEquity),
    "Yours to borrow against": r.usableEquity,
  }));
  const bands: [string, string][] = [
    ["You owe", SERIES[6]],
    ["Yours, but locked in", INK.quiet],
    ["Yours to borrow against", SERIES[0]],
  ];
  return (
    <ResponsiveContainer width="100%" height={250}>
      <AreaChart data={data} margin={{ left: 4, right: 8, top: 8, bottom: 4 }}>
        <CartesianGrid {...GRID} vertical={false} />
        <XAxis dataKey="year" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: INK.axis }} />
        <YAxis
          tickFormatter={compactMoney}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          width={48}
        />
        <Tooltip content={<ChartTooltip />} />
        <Legend wrapperStyle={legendStyle} iconType="square" iconSize={9} />
        {bands.map(([name, color]) => (
          <Area
            key={name}
            type="monotone"
            dataKey={name}
            stackId="value"
            fill={color}
            fillOpacity={0.9}
            // The 2px surface gap between stacked fills — white, not a stroke colour.
            stroke={INK.surface}
            strokeWidth={2}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

/**
 * Net worth against debt. Net worth is the point, so it carries the fill; debt is
 * context and rides as a thin line on the same dollar axis.
 */
export function NetWorthChart({ years }: { years: SimYear[] }) {
  const data = years.map((y) => ({ year: y.year, "Net worth": y.netWorth, "You owe": y.debt }));
  return (
    <ResponsiveContainer width="100%" height={230}>
      <AreaChart data={data} margin={{ left: 4, right: 8, top: 8, bottom: 4 }}>
        <CartesianGrid {...GRID} vertical={false} />
        <XAxis dataKey="year" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: INK.axis }} />
        <YAxis
          tickFormatter={compactMoney}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          width={48}
        />
        <Tooltip content={<ChartTooltip />} />
        <Legend wrapperStyle={legendStyle} iconType="square" iconSize={9} />
        <Area
          type="monotone"
          dataKey="Net worth"
          stroke={SERIES[0]}
          strokeWidth={2}
          fill={SERIES[0]}
          fillOpacity={0.12}
        />
        <Line type="monotone" dataKey="You owe" stroke={SERIES[6]} strokeWidth={2} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/**
 * Weekly cashflow under each shock, as bars either side of a zero line.
 *
 * Built in plain HTML so the rounded end sits on the data end and the baseline
 * end stays square, and so every bar carries its own visible value — the sign is
 * never left to colour alone.
 */
export function ShockChart({
  rows,
}: {
  rows: { label: string; weeklyCashflow: number }[];
}) {
  const max = Math.max(...rows.map((r) => Math.abs(r.weeklyCashflow)), 1);
  // Each arm gets 42% rather than a full half, so the longest bar still leaves
  // room for its own value label instead of colliding with it.
  const ARM = 42;
  return (
    <ul className="space-y-2">
      {rows.map((r) => {
        const pos = r.weeklyCashflow >= 0;
        const width = (Math.abs(r.weeklyCashflow) / max) * ARM;
        // Long bars carry the label inside; short ones can't fit it, so it sits
        // just past the data end.
        const inside = width > 14;
        const value = `${pos ? "+" : "−"}${money(Math.abs(r.weeklyCashflow))}`;
        return (
          <li key={r.label} className="flex items-center gap-3 text-xs">
            <span className="w-40 shrink-0 text-right leading-tight text-slate-600">{r.label}</span>
            <span className="relative flex h-5 flex-1 items-center">
              <span aria-hidden className="absolute left-1/2 top-0 h-full w-px" style={{ background: INK.axis }} />
              <span
                className="absolute flex h-3.5 items-center"
                style={{
                  background: pos ? STATUS.good : STATUS.critical,
                  width: `${width}%`,
                  left: pos ? "50%" : `${50 - width}%`,
                  justifyContent: pos ? "flex-end" : "flex-start",
                  // Rounded at the data end, square where it meets the baseline.
                  borderRadius: pos ? "0 4px 4px 0" : "4px 0 0 4px",
                }}
              >
                {inside && (
                  <span className="px-1.5 text-[10px] font-semibold tabular-nums text-white">
                    {value}
                  </span>
                )}
              </span>
              {!inside && (
                <span
                  className={`absolute whitespace-nowrap text-[11px] font-semibold tabular-nums ${
                    pos ? "text-emerald-800" : "text-rose-800"
                  }`}
                  style={{
                    left: pos ? `calc(50% + ${width}% + 6px)` : undefined,
                    right: pos ? undefined : `calc(50% + ${width}% + 6px)`,
                  }}
                >
                  {value}
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
