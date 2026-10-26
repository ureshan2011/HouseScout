"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, Finance, fmt, Listing } from "@/lib/api";
import { PayoffChart } from "@/components/PayoffChart";
import { Markdown } from "@/components/Markdown";
import { PropertyGallery } from "@/components/PropertyImage";
import { displayPrice } from "@/lib/price";
import { DataQualityNotice } from "@/components/DataQualityBadge";
import {
  ValuationCard,
  NegotiationCard,
  ForecastCard,
  RentCard,
  DealBadge,
} from "@/components/ValuationPanel";
import { PrintReportButton } from "@/components/PrintReport";
import { ListingScenarios } from "@/components/ListingScenarios";
import { WATCHLIST_EVENT, isWatched, toggleWatch } from "@/lib/watchlist";
import { useFeature } from "@/components/Gate";

export default function ListingDetailClient() {
  const params = useParams<{ id: string }>();
  const lid = Number(params.id);
  const [l, setL] = useState<Listing | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [fin, setFin] = useState<Finance | null>(null);
  const [insight, setInsight] = useState<string>("");
  const [insightModel, setInsightModel] = useState<string | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);

  useEffect(() => {
    api.listing(lid).then((x) => {
      setL(x ?? null);
      setLoaded(true);
    });
    api.financeForListing(lid).then(setFin).catch(() => {});
    getInsight();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lid]);

  async function getInsight() {
    setAnalysisLoading(true);
    try {
      const r = await api.insight(lid);
      setInsight(r.content);
      setInsightModel(r.model);
    } finally {
      setAnalysisLoading(false);
    }
  }

  if (!l) return <p className="text-sm text-slate-500">{loaded ? "Listing not found." : "Loading…"}</p>;
  const comps = l.score?.components?.components ?? {};
  const price = displayPrice(l);
  const land = l.enrichment?.land_area_m2 ?? l.land_area_m2;

  return (
    <div className="space-y-6 pb-16 md:pb-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-bold leading-tight sm:text-2xl">{l.address}</h1>
          <p className="text-slate-500">{l.suburb} · {l.property_type}</p>
        </div>
        <div className="sm:text-right">
          <p className="text-3xl font-bold text-brand-dark sm:text-2xl">
            {price.estimated && (
              <span className="text-base font-normal text-slate-400">est. </span>
            )}
            {fmt.money(price.value)}
          </p>
          {price.estimated && (
            <p className="text-xs text-amber-700">
              {l.price_text || "no price published"} — HouseScout estimate
            </p>
          )}
          {l.score && <p className="text-sm text-slate-500">Match score {l.score.match_score.toFixed(0)}/100</p>}
          <div className="mt-1 flex gap-2 sm:justify-end">
            <DealBadge listing={l} />
          </div>
        </div>
      </div>

      {/* Photos before the print/upsell row: on a phone the upsell used to push the
          first photo a full screen down the page. */}
      <PropertyGallery listing={l} />

      <div className="flex flex-wrap items-center gap-2">
        <PrintReportButton />
      </div>

      <DataQualityNotice listing={l} />

      <div className="grid grid-cols-2 gap-x-4 gap-y-4 md:grid-cols-3 md:gap-6">
        <Spec label="Bedrooms" value={l.bedrooms} />
        <Spec label="Bathrooms" value={l.bathrooms} />
        <Spec label="Garage" value={l.has_garage ? "Yes" : "No"} />
        <Spec label="Land area" value={land ? `${Math.round(land)} m²` : "—"} />
        <Spec label="Floor area" value={l.floor_area_m2 ? `${l.floor_area_m2} m²` : "—"} />
        <Spec label="Est. value" value={fmt.money(l.enrichment?.estimate_value)} />
      </div>

      {l.description && <Description text={l.description} />}

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

      {/* Prediction engine — valuation, rent, negotiation, growth */}
      <ValuationCard listing={l} />
      <RentCard listing={l} />
      <div className="grid gap-6 md:grid-cols-2">
        <NegotiationCard listing={l} />
        <ForecastCard listing={l} />
      </div>
      <ListingScenarios listing={l} />

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

      {/* Written analysis, generated at build time from this listing's numbers */}
      <section className="card p-4">
        <div className="mb-3">
          <h2 className="font-semibold">Property analysis</h2>
          {insightModel && <p className="text-xs text-slate-400">{insightModel}</p>}
        </div>
        {insight ? (
          <Markdown text={insight} />
        ) : (
          <p className="text-sm text-slate-500">
            {analysisLoading ? "Loading analysis…" : "No written analysis for this listing."}
          </p>
        )}
      </section>

      {l.url && (
        <a href={l.url} target="_blank" rel="noreferrer" className="btn-ghost hidden md:inline-flex">View original listing ↗</a>
      )}

      <ActionBar listingId={l.id} url={l.url} price={fmt.money(price.value)} estimated={price.estimated} />
    </div>
  );
}

/**
 * Phone-only bar pinned above the tab bar. The two things you do with a listing —
 * save it, and go to the real page to contact the agent — used to be (respectively)
 * missing and the last element of a page several thousand pixels long.
 */
function ActionBar({ listingId, url, price, estimated }: { listingId: number; url?: string | null; price: string; estimated: boolean }) {
  const { allowed } = useFeature("watchlist");
  const [on, setOn] = useState(false);
  useEffect(() => {
    const sync = () => setOn(isWatched(listingId));
    sync();
    window.addEventListener(WATCHLIST_EVENT, sync);
    return () => window.removeEventListener(WATCHLIST_EVENT, sync);
  }, [listingId]);

  return (
    <div
      className="fixed inset-x-0 z-30 border-t border-slate-200 bg-white/95 px-4 py-2 backdrop-blur md:hidden print:hidden"
      style={{ bottom: "calc(var(--tabbar-h) + env(safe-area-inset-bottom))" }}
    >
      <div className="mx-auto flex max-w-lg items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-bold leading-tight text-brand-dark">
            {estimated && <span className="text-sm font-normal text-slate-400">est. </span>}
            {price}
          </p>
        </div>
        {allowed && (
          <button
            type="button"
            aria-pressed={on}
            aria-label={on ? "Remove from watchlist" : "Add to watchlist"}
            onClick={() => setOn(toggleWatch(listingId))}
            className="btn-ghost press h-11 w-11 shrink-0 p-0 text-xl leading-none"
          >
            {on ? "★" : "☆"}
          </button>
        )}
        {url && (
          <a href={url} target="_blank" rel="noreferrer" className="btn shrink-0">
            View listing ↗
          </a>
        )}
      </div>
    </div>
  );
}

/** Agent copy runs to dozens of lines; on a phone it folds to six until asked for. */
function Description({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 380;
  return (
    <div>
      <p
        className={`whitespace-pre-line text-[15px] leading-relaxed text-slate-700 md:text-sm ${
          long && !open ? "line-clamp-6 md:line-clamp-none" : ""
        }`}
      >
        {text}
      </p>
      {long && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="press mt-1 min-h-[2.75rem] text-sm font-medium text-brand-dark underline md:hidden"
        >
          {open ? "Show less" : "Read more"}
        </button>
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
