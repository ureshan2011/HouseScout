"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, fmt } from "@/lib/api";
import { analyse } from "@/lib/finance";
import { loadProfile } from "@/lib/criteria";

export default function Insights() {
  const [suburbs, setSuburbs] = useState<any[]>([]);
  const [rates, setRates] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [market, setMarket] = useState<Awaited<ReturnType<typeof api.market>> | null>(null);

  useEffect(() => {
    api.suburbs().then(setSuburbs);
    api.rates().then(setRates);
    api.stats().then(setStats).catch(() => {});
    api.market().then(setMarket).catch(() => {});
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

      {market && market.total > 0 && (
        <section className="card p-4">
          <h2 className="mb-1 font-semibold">What&apos;s on the market right now</h2>
          <p className="mb-3 text-xs text-slate-400">
            Measured from the {fmt.num(market.total)} listings in this build.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Median price"
              value={fmt.money(market.medianPrice)}
              hint={`${fmt.money(market.lowPrice)} – ${fmt.money(market.highPrice)}`}
            />
            <StatCard
              label="Publish an asking price"
              value={fmt.pct(market.publishedPriceShare * 100)}
              hint="the rest show a HouseScout estimate"
            />
            <StatCard label="Have a garage" value={fmt.pct(market.garageShare * 100)} />
            <StatCard
              label="Median section"
              value={market.medianLand ? `${Math.round(market.medianLand)} m²` : "—"}
              hint={market.medianBedrooms ? `${market.medianBedrooms} bed typical` : undefined}
            />
          </div>
          <div className="mt-4">
            <p className="mb-2 text-xs uppercase tracking-wide text-slate-400">How they&apos;re sold</p>
            <div className="flex flex-wrap gap-2">
              {market.methods.map((m) => (
                <span key={m.label} className="badge bg-slate-100 text-slate-700">
                  {m.label} · {fmt.pct(m.share * 100)}
                </span>
              ))}
            </div>
          </div>
        </section>
      )}

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

      <BoarderLadder />

      <section className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Current mortgage rates (lowest by term)</h2>
        </div>
        <p className="mb-2 text-xs text-slate-400">
          Bundled snapshot. The optional Python backend refreshes these from interest.co.nz.
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
          <p>Listings refresh every 6 hours, merged and deduplicated by address:</p>
          <ul className="ml-5 list-disc space-y-1">
            <li><strong>realestate.co.nz</strong> and <strong>trademe.co.nz</strong> — listings</li>
            <li><strong>oneroof.co.nz</strong> — estimates and rateable values</li>
            <li><strong>LINZ</strong> — land area, CC-BY 4.0</li>
          </ul>
          <p>Anything we couldn&apos;t observe is labelled as an estimate on the listing itself.</p>
        </div>
      </section>
    </div>
  );
}

/**
 * How the boarder strategy scales with bedrooms — run through the same engine the
 * planner uses, against the visitor's own profile, rather than typed in by hand.
 */
function BoarderLadder() {
  const rows = useMemo(() => {
    const p = loadProfile();
    return [2, 3, 4, 5].map((beds) => {
      const price = Math.round(p.max_price * (0.76 + beds * 0.06));
      const f = analyse({
        price,
        deposit: p.deposit,
        annual_rate: p.annual_rate,
        term_years: p.term_years,
        bedrooms: beds,
        weekly_rent: p.weekly_rent,
      });
      return { beds, price, f };
    });
  }, []);
  const p = loadProfile();

  return (
    <section className="card p-4">
      <h2 className="mb-1 font-semibold">Boarder income by bedroom count</h2>
      <p className="mb-3 text-xs text-slate-400">
        Your profile: {fmt.money(p.deposit)} deposit, {(p.annual_rate * 100).toFixed(2)}%,{" "}
        {p.term_years} years, {fmt.money(p.weekly_rent)}/wk per room. Includes rates, insurance and
        maintenance. <Link href="/settings" className="underline">Change it</Link>.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-slate-400">
              <th className="py-2">Beds</th>
              <th>Price</th>
              <th>Rooms let</th>
              <th>Room income/mo</th>
              <th>Mortgage/mo</th>
              <th>Out of pocket/mo</th>
              <th>Payoff</th>
              <th>Interest saved</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ beds, price, f }) => (
              <tr key={beds} className="border-t border-slate-100">
                <td className="py-2 font-medium">{beds}</td>
                <td>{fmt.money(price)}</td>
                <td>{f.boarder.rentable_rooms}</td>
                <td className="text-emerald-700">{fmt.money(f.monthly_boarder_income)}</td>
                <td className="text-rose-600">{fmt.money(f.monthly_payment)}</td>
                <td className={f.net_monthly_outlay <= 0 ? "font-semibold text-emerald-700" : "text-amber-700"}>
                  {fmt.money(f.net_monthly_outlay)}
                </td>
                <td className="font-semibold">{f.accelerated.payoff_years ?? "—"} yr</td>
                <td>{fmt.money(f.interest_saved)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-slate-400">
        Boarder income is tax-free up to the IRD threshold, and most banks won&apos;t count it toward
        what they&apos;ll lend you. See the <Link href="/strategy" className="underline">Strategy Lab</Link>{" "}
        for what happens after year one.
      </p>
    </section>
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
