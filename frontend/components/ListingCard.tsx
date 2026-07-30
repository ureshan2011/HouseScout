"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Listing, fmt } from "@/lib/api";
import { PropertyImage } from "@/components/PropertyImage";
import { DataQualityBadge } from "@/components/DataQualityBadge";
import { WATCHLIST_EVENT, isWatched, toggleWatch } from "@/lib/watchlist";
import { useFeature } from "@/components/Gate";

function scoreColor(s: number) {
  if (s >= 60) return "bg-emerald-100 text-emerald-800";
  if (s >= 45) return "bg-amber-100 text-amber-800";
  return "bg-slate-100 text-slate-700";
}

/** Star toggle for the watchlist. Pro feature; hidden on the free tier. */
function WatchButton({ id }: { id: number }) {
  const { allowed } = useFeature("watchlist");
  const [on, setOn] = useState(false);

  useEffect(() => {
    const sync = () => setOn(isWatched(id));
    sync();
    window.addEventListener(WATCHLIST_EVENT, sync);
    return () => window.removeEventListener(WATCHLIST_EVENT, sync);
  }, [id]);

  if (!allowed) return null;

  return (
    <button
      type="button"
      aria-label={on ? "Remove from watchlist" : "Add to watchlist"}
      aria-pressed={on}
      title={on ? "Remove from watchlist" : "Add to watchlist"}
      onClick={(e) => {
        // The card body is a Link; keep this click from navigating.
        e.preventDefault();
        e.stopPropagation();
        setOn(toggleWatch(id));
      }}
      className="absolute left-2 top-2 rounded-full bg-white/85 px-2 py-1 text-sm leading-none shadow-sm transition hover:bg-white"
    >
      {on ? "★" : "☆"}
    </button>
  );
}

export function ListingCard({ l }: { l: Listing }) {
  const score = l.score?.match_score ?? 0;
  const rooms = l.score?.components?.rentable_rooms ?? 0;
  const land = l.enrichment?.land_area_m2 ?? l.land_area_m2;

  return (
    <div className="card relative overflow-hidden transition hover:shadow-md">
      <Link href={`/listings/${l.id}`} className="block">
        <div className="relative h-40 w-full bg-slate-200">
          <PropertyImage listing={l} />
          <span className={`badge absolute right-2 top-2 ${scoreColor(score)}`}>
            Score {score.toFixed(0)}
          </span>
        </div>
        <div className="space-y-1 p-3">
          <div className="flex items-baseline justify-between gap-2">
            <p className="font-semibold">{fmt.money(l.price)}</p>
            <span className="text-xs uppercase text-slate-400">{l.property_type}</span>
          </div>
          <DataQualityBadge listing={l} compact />
          <p className="truncate text-sm font-medium">{l.address}</p>
          <p className="text-xs text-slate-500">{l.suburb}</p>
          <div className="flex flex-wrap gap-1 pt-1 text-xs text-slate-600">
            <span className="badge bg-slate-100">{l.bedrooms ?? "?"} bd</span>
            <span className="badge bg-slate-100">{l.bathrooms ?? "?"} ba</span>
            {l.has_garage && <span className="badge bg-teal-50 text-teal-700">garage</span>}
            {land ? <span className="badge bg-slate-100">{Math.round(land)} m²</span> : null}
            {rooms > 0 && (
              <span className="badge bg-indigo-50 text-indigo-700">{rooms} rooms to rent</span>
            )}
          </div>
        </div>
      </Link>
      <WatchButton id={l.id} />
    </div>
  );
}
