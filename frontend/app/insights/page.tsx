"use client";

import { useEffect, useState } from "react";
import { api, fmt } from "@/lib/api";

export default function Insights() {
  const [suburbs, setSuburbs] = useState<any[]>([]);
  const [rates, setRates] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    api.suburbs().then(setSuburbs);
    api.rates().then(setRates);
    api.stats().then(setStats).catch(() => {});
  }, []);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Investment insights</h1>

      {stats && (
        <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Total listings" value={fmt.num(stats.total_listings)} />
          <StatCard label="Matching criteria" value={fmt.num(stats.matching_listings)} />
          <StatCard label="Avg matching price" value={fmt.money(stats.avg_matching_price)} />
          <StatCard
            label="Best value suburb"
            value={suburbs[0]?.name ?? "..."}
            hint={suburbs[0] ? fmt.money(suburbs[0].median_price) : ""}
          />
        </section>
      )}

      <section className="card p-4">
        <h2 className="mb-2 font-semibold">Market overview (June 2026)</h2>
        <div className="grid gap-4 text-sm text-slate-700 md:grid-cols-2">
          <div className="space-y-2">
            <p>Christchurch residential prices have stabilised after the 2023-24 correction, with affordable eastern and southern suburbs showing renewed buyer interest.</p>
            <p>Interest rate cuts since late 2024 have improved affordability — 1-year fixed rates now sit around 4.65%, down from 7%+ peaks. This has particularly boosted the sub-$500k segment.</p>
          </div>
          <div className="space-y-2">
            <p>Eastern suburbs (Aranui, Wainoni, New Brighton) continue to benefit from regeneration investment including the He Puna Taimoana Hot Pools and new community facilities.</p>
            <p>The boarder strategy remains exceptionally viable at current rates: a 4-bedroom house at $450k with 3 rooms rented at $220/wk generates $2,860/mo — covering the typical $2,140/mo mortgage payment with surplus for accelerated repayment.</p>
          </div>
        </div>
      </section>

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
                <th className="hidden md:table-cell">Notes</th>
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
                  <td className="hidden max-w-xs truncate text-xs text-slate-500 md:table-cell">{s.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-slate-400">Indicative figures based on market data. Yields calculated as (annual rent / median price). Not financial advice.</p>
      </section>

      <section className="card p-4">
        <h2 className="mb-3 font-semibold">Boarder strategy comparison</h2>
        <p className="mb-3 text-xs text-slate-400">
          How the room-rental strategy works across different price points. Assumes $50k deposit, 5.19% rate, 30yr term, $220/wk per room.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-400">
                <th className="py-2">Scenario</th>
                <th>Price</th>
                <th>Beds</th>
                <th>Rooms to rent</th>
                <th>Monthly income</th>
                <th>Monthly mortgage</th>
                <th>Net position</th>
                <th>Payoff</th>
              </tr>
            </thead>
            <tbody>
              {[
                { label: "2-bed entry", price: 380000, beds: 2, rooms: 1, income: 953, mortgage: 1810, payoff: "23 yr" },
                { label: "3-bed standard", price: 450000, beds: 3, rooms: 2, income: 1907, mortgage: 2192, payoff: "18 yr" },
                { label: "4-bed ideal", price: 480000, beds: 4, rooms: 3, income: 2860, mortgage: 2356, payoff: "13 yr" },
                { label: "5-bed maximum", price: 500000, beds: 5, rooms: 4, income: 3813, mortgage: 2466, payoff: "10 yr" },
              ].map((s) => (
                <tr key={s.label} className="border-t border-slate-100">
                  <td className="py-2 font-medium">{s.label}</td>
                  <td>{fmt.money(s.price)}</td>
                  <td>{s.beds}</td>
                  <td>{s.rooms}</td>
                  <td className="text-emerald-700">{fmt.money(s.income)}</td>
                  <td className="text-red-600">{fmt.money(s.mortgage)}</td>
                  <td className={s.income >= s.mortgage ? "font-semibold text-emerald-700" : "text-amber-700"}>
                    {fmt.money(s.income - s.mortgage)}/mo
                  </td>
                  <td className="font-semibold">{s.payoff}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Current mortgage rates (lowest by term)</h2>
        </div>
        <p className="mb-2 text-xs text-slate-400">
          Indicative June 2026 rates. Run the optional Python backend to refresh live from interest.co.nz.
        </p>
        <div className="flex flex-wrap gap-3">
          {rates.map((r, i) => (
            <div key={i} className="rounded-lg bg-slate-50 px-4 py-3">
              <p className="text-xs text-slate-500">{r.bank} · {r.term_label}</p>
              <p className="text-lg font-bold">{(r.rate * 100).toFixed(2)}%</p>
            </div>
          ))}
        </div>
      </section>

      <section className="card p-4">
        <h2 className="mb-3 font-semibold">Data sources</h2>
        <div className="space-y-2 text-sm text-slate-600">
          <p>Listings are scraped every 6 hours from multiple sources using parallel CI runners:</p>
          <ul className="ml-5 list-disc space-y-1">
            <li><strong>realestate.co.nz</strong> — Primary source. API + Playwright scraping with Chromium.</li>
            <li><strong>trademe.co.nz</strong> — Secondary source. Playwright with Firefox (different browser fingerprint).</li>
            <li><strong>oneroof.co.nz</strong> — Tertiary source. Used for enrichment data (estimates, RV).</li>
            <li><strong>LINZ</strong> — Official NZ land data for accurate land area figures.</li>
          </ul>
          <p>Each source runs on a separate GitHub Actions runner (different IP address), with varied browser engines and user-agent signatures to minimise blocking. Results are merged, deduplicated by normalised address, and the richest record is kept.</p>
        </div>
      </section>
    </div>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-xl font-bold">{value}</p>
      {hint && <p className="mt-0.5 truncate text-xs text-slate-400">{hint}</p>}
    </div>
  );
}
