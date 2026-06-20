"use client";

import Link from "next/link";
import { Listing, fmt } from "@/lib/api";

function scoreColor(s: number) {
  if (s >= 60) return "bg-emerald-100 text-emerald-800";
  if (s >= 45) return "bg-amber-100 text-amber-800";
  return "bg-slate-100 text-slate-700";
}

export function ListingCard({ l }: { l: Listing }) {
  const score = l.score?.match_score ?? 0;
  const rooms = l.score?.components?.rentable_rooms ?? 0;
  const land = l.enrichment?.land_area_m2 ?? l.land_area_m2;
  return (
    <Link href={`/listings/${l.id}`} className="card overflow-hidden transition hover:shadow-md">
      <div className="relative h-40 w-full bg-slate-200">
        {l.images?.[0] && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={l.images[0].url} alt={l.address ?? ""} className="h-full w-full object-cover" />
        )}
        <span className={`badge absolute right-2 top-2 ${scoreColor(score)}`}>Score {score.toFixed(0)}</span>
      </div>
      <div className="space-y-1 p-3">
        <div className="flex items-baseline justify-between">
          <p className="font-semibold">{fmt.money(l.price)}</p>
          <span className="text-xs uppercase text-slate-400">{l.property_type}</span>
        </div>
        <p className="truncate text-sm font-medium">{l.address}</p>
        <p className="text-xs text-slate-500">{l.suburb}</p>
        <div className="flex flex-wrap gap-1 pt-1 text-xs text-slate-600">
          <span className="badge bg-slate-100">{l.bedrooms ?? "?"} bd</span>
          <span className="badge bg-slate-100">{l.bathrooms ?? "?"} ba</span>
          {l.has_garage && <span className="badge bg-teal-50 text-teal-700">garage</span>}
          {land ? <span className="badge bg-slate-100">{Math.round(land)} m²</span> : null}
          {rooms > 0 && <span className="badge bg-indigo-50 text-indigo-700">{rooms} rooms to rent</span>}
        </div>
      </div>
    </Link>
  );
}
