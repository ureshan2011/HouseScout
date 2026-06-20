"use client";

import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function PayoffChart({ standard, accelerated }: { standard: number[]; accelerated: number[] }) {
  const len = Math.max(standard.length, accelerated.length);
  const data = Array.from({ length: len }, (_, i) => ({
    year: i,
    Standard: standard[i] ?? null,
    "With room rent": accelerated[i] ?? null,
  }));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ left: 10, right: 10, top: 10 }}>
        <XAxis dataKey="year" tick={{ fontSize: 11 }} label={{ value: "Years", position: "insideBottom", offset: -2, fontSize: 11 }} />
        <YAxis tickFormatter={(v) => `${Math.round(v / 1000)}k`} tick={{ fontSize: 11 }} width={40} />
        <Tooltip formatter={(v: number) => new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD", maximumFractionDigits: 0 }).format(v)} />
        <Line type="monotone" dataKey="Standard" stroke="#94a3b8" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="With room rent" stroke="#0d9488" strokeWidth={2.5} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
