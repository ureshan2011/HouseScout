"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { EquityYear, SimYear } from "@/lib/strategy";

const money = (v: number) =>
  new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD", maximumFractionDigits: 0 }).format(v);

const AXIS = { fontSize: 11 } as const;

/** Debt against value, with the releasable slice highlighted. */
export function EquityChart({ rows }: { rows: EquityYear[] }) {
  const data = rows.map((r) => ({
    year: r.year,
    Debt: r.balance,
    "Locked equity": Math.max(0, r.equity - r.usableEquity),
    "Releasable equity": r.usableEquity,
  }));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ left: 4, right: 8, top: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="year" tick={AXIS} />
        <YAxis tickFormatter={(v) => `${Math.round(v / 1000)}k`} tick={AXIS} width={44} />
        <Tooltip formatter={(v: number) => money(v)} labelFormatter={(y) => `Year ${y}`} />
        <Legend wrapperStyle={AXIS} />
        <Area type="monotone" dataKey="Debt" stackId="1" stroke="#f43f5e" fill="#fecdd3" />
        <Area type="monotone" dataKey="Locked equity" stackId="1" stroke="#94a3b8" fill="#e2e8f0" />
        <Area type="monotone" dataKey="Releasable equity" stackId="1" stroke="#0d9488" fill="#99f6e4" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Net worth over the horizon for one strategy run. */
export function NetWorthChart({ years }: { years: SimYear[] }) {
  const data = years.map((y) => ({ year: y.year, "Net worth": y.netWorth, Debt: y.debt }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ left: 4, right: 8, top: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="year" tick={AXIS} />
        <YAxis tickFormatter={(v) => `${Math.round(v / 1000)}k`} tick={AXIS} width={44} />
        <Tooltip formatter={(v: number) => money(v)} labelFormatter={(y) => `Year ${y}`} />
        <Legend wrapperStyle={AXIS} />
        <Area type="monotone" dataKey="Net worth" stroke="#0d9488" fill="#99f6e4" />
        <Area type="monotone" dataKey="Debt" stroke="#f43f5e" fill="#fecdd3" fillOpacity={0.5} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Weekly cashflow under each shock; red bars are the weeks you fund yourself. */
export function ShockChart({ rows }: { rows: { label: string; weeklyCashflow: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={rows} margin={{ left: 4, right: 8, top: 8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="label" tick={{ fontSize: 9 }} interval={0} height={44} angle={-12} textAnchor="end" />
        <YAxis tick={AXIS} width={44} />
        <Tooltip formatter={(v: number) => `${money(v)}/wk`} />
        <Bar dataKey="weeklyCashflow" radius={[3, 3, 0, 0]}>
          {rows.map((r, i) => (
            <Cell key={i} fill={r.weeklyCashflow >= 0 ? "#0d9488" : "#f43f5e"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
