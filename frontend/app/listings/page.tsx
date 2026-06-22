"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { api, Listing } from "@/lib/api";
import { ListingCard } from "@/components/ListingCard";

// MapLibre touches `window`, so load it client-side only.
const ListingsMap = dynamic(() => import("@/components/ListingsMap").then((m) => m.ListingsMap), {
  ssr: false,
  loading: () => <p className="text-sm text-slate-500">Loading map…</p>,
});

export default function ListingsPage() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState("score");
  const [maxPrice, setMaxPrice] = useState("");
  const [minBeds, setMinBeds] = useState("");
  const [garageOnly, setGarageOnly] = useState(true);
  const [passesOnly, setPassesOnly] = useState(true);
  const [view, setView] = useState<"grid" | "map">("grid");

  function load() {
    setLoading(true);
    const p = new URLSearchParams({ sort, passes_only: String(passesOnly), garage_only: String(garageOnly) });
    if (maxPrice) p.set("max_price", maxPrice);
    if (minBeds) p.set("min_bedrooms", minBeds);
    api.listings(`?${p.toString()}`).then(setListings).finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort, garageOnly, passesOnly]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Listings</h1>
        <div className="flex rounded-lg border border-slate-300 text-sm">
          <button className={`px-3 py-1.5 ${view === "grid" ? "bg-brand text-white" : ""}`} onClick={() => setView("grid")}>
            Grid
          </button>
          <button className={`px-3 py-1.5 ${view === "map" ? "bg-brand text-white" : ""}`} onClick={() => setView("map")}>
            Map
          </button>
        </div>
      </div>

      <div className="card flex flex-wrap items-end gap-3 p-4">
        <Field label="Sort">
          <select className="input" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="score">Best match</option>
            <option value="price">Price (low → high)</option>
            <option value="price_desc">Price (high → low)</option>
            <option value="newest">Newest</option>
          </select>
        </Field>
        <Field label="Max price">
          <input className="input" inputMode="numeric" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} placeholder="500000" />
        </Field>
        <Field label="Min beds">
          <input className="input" inputMode="numeric" value={minBeds} onChange={(e) => setMinBeds(e.target.value)} placeholder="3" />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={garageOnly} onChange={(e) => setGarageOnly(e.target.checked)} /> Garage only
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={passesOnly} onChange={(e) => setPassesOnly(e.target.checked)} /> Meets all criteria
        </label>
        <button className="btn" onClick={load}>Apply</button>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : listings.length === 0 ? (
        <p className="text-sm text-slate-500">No listings match. Loosen the filters, or check that live Trade Me data was fetched at build time.</p>
      ) : view === "map" ? (
        <ListingsMap listings={listings} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {listings.map((l) => (
            <ListingCard key={l.id} l={l} />
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      {children}
    </div>
  );
}
