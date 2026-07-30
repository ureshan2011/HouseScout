"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, Listing, fmt } from "@/lib/api";
import { Model, Prediction, loadModel, predict } from "@/lib/predict";
import { Gate } from "@/components/Gate";
import { PropertyImage } from "@/components/PropertyImage";
import {
  MAX_COMPARE,
  WATCHLIST_EVENT,
  clearWatchlist,
  getWatchlist,
  removeWatch,
} from "@/lib/watchlist";
import { toCsv, downloadCsv } from "@/lib/exportCsv";

// Watchlist + side-by-side compare.
//
// Shortlisting is where a buyer actually makes the decision, and it is the moment
// the numbers matter most — so this page puts the model's valuation, rent and
// payoff figures for the shortlisted properties in one column-per-property table.

type Row = { listing: Listing; prediction: Prediction };

export default function Watchlist() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [model, setModel] = useState<Model | null>(null);

  useEffect(() => {
    let alive = true;

    async function load() {
      const [all, m] = await Promise.all([api.listings("?passes_only=false&limit=200"), loadModel()]);
      if (!alive) return;
      setModel(m);
      const ids = getWatchlist();
      const byId = new Map(all.map((l) => [l.id, l]));
      setRows(
        ids
          .map((id) => byId.get(id))
          .filter((l): l is Listing => !!l)
          .map((listing) => ({ listing, prediction: predict(listing, m) })),
      );
    }

    load();
    window.addEventListener(WATCHLIST_EVENT, load);
    return () => {
      alive = false;
      window.removeEventListener(WATCHLIST_EVENT, load);
    };
  }, []);

  function exportCsv() {
    if (!rows) return;
    downloadCsv(
      "housescout-watchlist.csv",
      toCsv(
        rows.map(({ listing: l, prediction: p }) => ({
          address: l.address ?? "",
          suburb: l.suburb ?? "",
          price: l.price ?? "",
          price_basis: l.data_quality === "observed" ? "listed" : "estimated",
          modelled_value: p.valuation.estimate,
          delta_pct: p.position?.deltaPct ?? "",
          deal_grade: p.deal.grade,
          room_rent_weekly: p.rent.perRoomWeekly,
          target_offer: p.negotiation.targetOffer ?? "",
          ceiling: p.negotiation.ceiling,
          url: l.url ?? "",
        })),
      ),
    );
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Watchlist</h1>
          <p className="text-sm text-slate-600">
            Your shortlist, compared side by side on the numbers that decide it.
          </p>
        </div>
        {rows && rows.length > 0 && (
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={exportCsv}>
              ⬇ Export CSV
            </button>
            <button className="btn-ghost" onClick={() => clearWatchlist()}>
              Clear all
            </button>
          </div>
        )}
      </header>

      <Gate
        feature="watchlist"
        title="Watchlist & compare"
        blurb="Star the properties you're serious about and compare their valuation, rent and payoff numbers side by side."
      >
        {rows == null ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : rows.length === 0 ? (
          <div className="card p-6 text-center">
            <p className="text-sm text-slate-600">
              Nothing saved yet. Tap the ☆ on any listing card to add it here.
            </p>
            <Link href="/listings" className="btn mt-3">
              Browse listings
            </Link>
          </div>
        ) : (
          <>
            {rows.length > MAX_COMPARE && (
              <p className="text-xs text-amber-700">
                Showing the first {MAX_COMPARE} of {rows.length} — remove some to compare others.
              </p>
            )}
            <CompareTable rows={rows.slice(0, MAX_COMPARE)} model={model} />
          </>
        )}
      </Gate>
    </div>
  );
}

function CompareTable({ rows, model }: { rows: Row[]; model: Model | null }) {
  // Each metric is a row and each property a column, so values line up for scanning.
  const metrics: { label: string; render: (r: Row) => React.ReactNode; best?: "high" | "low" }[] = [
    { label: "Price", render: (r) => fmt.money(r.listing.price) },
    { label: "Modelled value", render: (r) => fmt.money(r.prediction.valuation.estimate) },
    {
      label: "Gap to model",
      render: (r) =>
        r.prediction.position
          ? `${r.prediction.position.deltaPct > 0 ? "+" : ""}${r.prediction.position.deltaPct}%`
          : "—",
      best: "low",
    },
    { label: "Deal grade", render: (r) => `${r.prediction.deal.grade} (${r.prediction.deal.score})`, best: "high" },
    { label: "Bedrooms", render: (r) => r.listing.bedrooms ?? "—" },
    { label: "Rooms to let", render: (r) => r.listing.score?.components?.rentable_rooms ?? 0, best: "high" },
    { label: "Room rent /wk", render: (r) => `$${r.prediction.rent.perRoomWeekly}`, best: "high" },
    { label: "Gross yield", render: (r) => `${r.prediction.rent.yieldPct}%`, best: "high" },
    { label: "Land", render: (r) => (r.listing.enrichment?.land_area_m2 ?? r.listing.land_area_m2) ? `${Math.round((r.listing.enrichment?.land_area_m2 ?? r.listing.land_area_m2)!)} m²` : "—" },
    {
      label: "Open at / ceiling",
      render: (r) =>
        r.prediction.negotiation.targetOffer != null
          ? fmt.money(r.prediction.negotiation.targetOffer)
          : `≤ ${fmt.money(r.prediction.negotiation.ceiling)}`,
    },
    { label: "Value in 10 yrs", render: (r) => fmt.money(r.prediction.growth.valueIn10), best: "high" },
    { label: "Match score", render: (r) => (r.listing.score?.match_score ?? 0).toFixed(0), best: "high" },
  ];

  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200">
            <th className="p-3 text-left text-xs uppercase tracking-wide text-slate-500">Metric</th>
            {rows.map(({ listing: l }) => (
              <th key={l.id} className="p-3 text-left align-top">
                <div className="h-20 w-full overflow-hidden rounded-lg bg-slate-200">
                  <PropertyImage listing={l} />
                </div>
                <Link href={`/listings/${l.id}`} className="mt-2 block font-medium hover:underline">
                  {l.address}
                </Link>
                <p className="text-xs font-normal text-slate-500">{l.suburb}</p>
                <button
                  className="mt-1 text-xs text-rose-600 hover:underline"
                  onClick={() => removeWatch(l.id)}
                >
                  Remove
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {metrics.map((m) => (
            <tr key={m.label} className="border-t border-slate-100">
              <td className="p-3 text-slate-600">{m.label}</td>
              {rows.map((r) => (
                <td key={r.listing.id} className="p-3 tabular-nums">
                  {m.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-slate-100 p-3 text-xs text-slate-500">
        Modelled values come from HouseScout&apos;s valuation model ({model?.confidence ?? "low"}{" "}
        confidence, calibrated on {model?.n_train ?? 0} published asking prices). Indicative only.
      </p>
    </div>
  );
}
