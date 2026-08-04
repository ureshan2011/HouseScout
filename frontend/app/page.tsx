"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, fmt, Listing } from "@/lib/api";
import { ListingCard } from "@/components/ListingCard";
import { Model, loadModel } from "@/lib/predict";
import { useProfile } from "@/lib/useProfile";

export default function Dashboard() {
  const [stats, setStats] = useState<any>(null);
  const [top, setTop] = useState<Listing[]>([]);
  const [model, setModel] = useState<Model | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const profile = useProfile();

  // Both figures here are scored against the buyer's criteria, so a change made
  // from anywhere has to re-run them.
  useEffect(() => {
    api.stats().then(setStats).catch((e) => setErr(String(e)));
    api.listings("?sort=score&limit=6").then(setTop).catch(() => {});
    loadModel().then(setModel).catch(() => setModel(null));
  }, [profile]);

  if (err)
    return (
      <div className="card p-6">
        <p className="font-semibold text-amber-600">Loading data...</p>
        <p className="mt-1 text-sm text-slate-600">
          Listings are loaded from the build-time scrape. If this persists, try refreshing the page.
        </p>
      </div>
    );

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-bold">Your Christchurch buying dashboard</h1>
        <p className="text-sm text-slate-500">
          Under $500k · garage + backyard · live in &amp; rent rooms to pay it off fast.
        </p>
      </section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Listings tracked" value={stats ? fmt.num(stats.total_listings) : "…"} />
        <Stat label="Matching your criteria" value={stats ? fmt.num(stats.matching_listings) : "…"} />
        <Stat label="Avg matching price" value={stats ? fmt.money(stats.avg_matching_price) : "…"} />
        <Stat
          label="Valuation model"
          value={model ? `${model.confidence} confidence` : "…"}
          hint={model ? `calibrated on ${model.n_train} listed prices` : undefined}
        />
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Top recommendations</h2>
          <div className="flex gap-3 text-sm">
            <Link href="/radar" className="text-brand-dark hover:underline">Deal Radar →</Link>
            <Link href="/listings" className="text-brand-dark hover:underline">View all →</Link>
          </div>
        </div>
        {top.length === 0 ? (
          <p className="text-sm text-slate-500">
            Loading listings... Scraped from realestate.co.nz, trademe.co.nz and oneroof.co.nz
            using parallel runners. Data refreshes every 6 hours.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {top.map((l) => (
              <ListingCard key={l.id} l={l} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-xl font-bold">{value}</p>
      {hint && <p className="mt-0.5 truncate text-xs text-slate-400">{hint}</p>}
    </div>
  );
}
