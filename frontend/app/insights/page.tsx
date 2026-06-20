"use client";

import { useEffect, useState } from "react";
import { api, fmt } from "@/lib/api";

export default function Insights() {
  const [suburbs, setSuburbs] = useState<any[]>([]);
  const [rates, setRates] = useState<any[]>([]);

  useEffect(() => {
    api.suburbs().then(setSuburbs);
    api.rates().then(setRates);
  }, []);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Investment insights</h1>

      <section className="card p-4">
        <h2 className="mb-3 font-semibold">Christchurch suburbs (affordability vs yield)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-400">
                <th className="py-2">Suburb</th>
                <th>Median price</th>
                <th>Median rent/wk</th>
                <th>Gross yield</th>
                <th>5yr growth</th>
                <th>CBD km</th>
              </tr>
            </thead>
            <tbody>
              {suburbs.map((s) => (
                <tr key={s.name} className="border-t border-slate-100">
                  <td className="py-2 font-medium">{s.name}</td>
                  <td>{fmt.money(s.median_price)}</td>
                  <td>{fmt.money(s.median_rent_weekly)}</td>
                  <td className="font-semibold text-brand-dark">{fmt.pct(s.rental_yield)}</td>
                  <td>{fmt.pct(s.growth_5yr_pct)}</td>
                  <td>{s.distance_cbd_km}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-slate-400">Indicative figures — refine from live sales/rental data.</p>
      </section>

      <section className="card p-4">
        <h2 className="mb-3 font-semibold">Current mortgage rates (lowest by term)</h2>
        <div className="flex flex-wrap gap-3">
          {rates.map((r, i) => (
            <div key={i} className="rounded-lg bg-slate-50 px-4 py-3">
              <p className="text-xs text-slate-500">{r.bank} · {r.term_label}</p>
              <p className="text-lg font-bold">{(r.rate * 100).toFixed(2)}%</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
