"use client";

import { use, useEffect, useState } from "react";
import { api, Finance, fmt, Listing } from "@/lib/api";
import { PayoffChart } from "@/components/PayoffChart";
import { Markdown } from "@/components/Markdown";

export default function ListingDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const lid = Number(id);
  const [l, setL] = useState<Listing | null>(null);
  const [fin, setFin] = useState<Finance | null>(null);
  const [insight, setInsight] = useState<string>("");
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    api.listing(lid).then(setL);
    api.financeForListing(lid).then(setFin);
  }, [lid]);

  async function getInsight(refresh = false) {
    setAiLoading(true);
    try {
      const r = await api.insight(lid, refresh);
      setInsight(r.content);
    } finally {
      setAiLoading(false);
    }
  }

  if (!l) return <p className="text-sm text-slate-500">Loading…</p>;
  const comps = l.score?.components?.components ?? {};
  const land = l.enrichment?.land_area_m2 ?? l.land_area_m2;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{l.address}</h1>
          <p className="text-slate-500">{l.suburb} · {l.property_type}</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-brand-dark">{fmt.money(l.price)}</p>
          {l.score && <p className="text-sm text-slate-500">Match score {l.score.match_score.toFixed(0)}/100</p>}
        </div>
      </div>

      {l.images?.[0] && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={l.images[0].url} alt={l.address ?? ""} className="h-64 w-full rounded-xl object-cover" />
      )}

      <div className="grid gap-6 md:grid-cols-3">
        <Spec label="Bedrooms" value={l.bedrooms} />
        <Spec label="Bathrooms" value={l.bathrooms} />
        <Spec label="Garage" value={l.has_garage ? "Yes" : "No"} />
        <Spec label="Land area" value={land ? `${Math.round(land)} m²` : "—"} />
        <Spec label="Floor area" value={l.floor_area_m2 ? `${l.floor_area_m2} m²` : "—"} />
        <Spec label="Est. value" value={fmt.money(l.enrichment?.estimate_value)} />
      </div>

      {l.description && <p className="text-sm leading-relaxed text-slate-700">{l.description}</p>}

      {/* Score breakdown */}
      <section className="card p-4">
        <h2 className="mb-3 font-semibold">Why it scored {l.score?.match_score.toFixed(0)}</h2>
        <div className="space-y-2">
          {Object.entries(comps).map(([k, v]) => (
            <div key={k} className="flex items-center gap-3">
              <span className="w-28 text-sm capitalize text-slate-600">{k.replace("_", " ")}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full bg-brand" style={{ width: `${(v as number) * 100}%` }} />
              </div>
              <span className="w-10 text-right text-xs text-slate-500">{Math.round((v as number) * 100)}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Finance */}
      {fin && (
        <section className="card p-4">
          <h2 className="mb-3 font-semibold">Rent-rooms financial picture</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <KPI label="Loan" value={fmt.money(fin.loan)} />
            <KPI label="Monthly P&I" value={fmt.money(fin.monthly_payment)} />
            <KPI label="Rooms to rent" value={String(fin.boarder.rentable_rooms)} />
            <KPI label="Room income / mo" value={fmt.money(fin.monthly_boarder_income)} />
            <KPI label="Net out-of-pocket / mo" value={fmt.money(fin.net_monthly_outlay)} accent={fin.net_monthly_outlay <= 0} />
            <KPI label="Gross yield" value={fmt.pct(fin.gross_yield_pct)} />
            <KPI label="Payoff (standard)" value={`${fin.standard.payoff_years ?? "—"} yr`} />
            <KPI label="Payoff (room rent)" value={`${fin.accelerated.payoff_years ?? "—"} yr`} accent />
          </div>
          {fin.years_saved != null && (
            <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
              Renting {fin.boarder.rentable_rooms} room(s) and reinvesting the income pays the
              mortgage off <strong>{fin.years_saved} years sooner</strong> and saves{" "}
              <strong>{fmt.money(fin.interest_saved)}</strong> in interest.
            </p>
          )}
          <div className="mt-4">
            <PayoffChart standard={fin.standard.yearly_balance} accelerated={fin.accelerated.yearly_balance} />
          </div>
        </section>
      )}

      {/* AI insight */}
      <section className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">AI insight (local Gemma)</h2>
          <div className="flex gap-2">
            <button className="btn" onClick={() => getInsight(false)} disabled={aiLoading}>
              {aiLoading ? "Thinking…" : insight ? "Refresh" : "Analyse"}
            </button>
          </div>
        </div>
        {insight ? <Markdown text={insight} /> : <p className="text-sm text-slate-500">Click Analyse to get pros/cons, red flags and a negotiation angle from your local model.</p>}
      </section>

      {l.url && (
        <a href={l.url} target="_blank" rel="noreferrer" className="btn-ghost">View original listing ↗</a>
      )}
    </div>
  );
}

function Spec({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="font-medium">{value ?? "—"}</p>
    </div>
  );
}

function KPI({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-lg p-3 ${accent ? "bg-emerald-50" : "bg-slate-50"}`}>
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`text-lg font-bold ${accent ? "text-emerald-700" : ""}`}>{value}</p>
    </div>
  );
}
