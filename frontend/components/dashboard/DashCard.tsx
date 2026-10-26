"use client";

import Link from "next/link";
import { Listing } from "@/lib/api";
import { Prediction } from "@/lib/predict";
import { displayPrice } from "@/lib/price";
import { money } from "@/lib/viz";
import { PropertyImage } from "@/components/PropertyImage";

export type Row = { l: Listing; p: Prediction };

const GRADE: Record<string, string> = {
  A: "bg-emerald-500 text-white",
  B: "bg-teal-500 text-white",
  C: "bg-amber-400 text-amber-950",
  D: "bg-slate-300 text-slate-800",
};

/**
 * A poster-style listing card: the photo carries the card, the numbers sit on a
 * gradient over it, and the three facts that decide whether to tap — beds, land, rooms
 * to rent — are underneath. Used in every rail on the dashboard.
 */
export function DashCard({ row, tag, tone = "dark" }: { row: Row; tag?: string; tone?: "dark" | "alert" }) {
  const { l, p } = row;
  const price = displayPrice(l);
  const land = l.enrichment?.land_area_m2 ?? l.land_area_m2;
  const rooms = Math.max(0, Math.min((l.bedrooms ?? 0) - 1, 4));

  return (
    <Link
      href={`/listings/${l.id}`}
      className="group relative block overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 transition active:scale-[0.99] hover:shadow-lg"
    >
      <div className="relative aspect-[4/5] bg-slate-200">
        <div className="absolute inset-0 transition duration-500 group-hover:scale-105">
          <PropertyImage listing={l} />
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/85 via-slate-950/10 to-transparent" />

        {tag && (
          <span
            className={`absolute left-3 top-3 rounded-full px-2.5 py-1 text-xs font-semibold backdrop-blur ${
              tone === "alert" ? "bg-rose-500 text-white" : "bg-white/90 text-slate-800"
            }`}
          >
            {tag}
          </span>
        )}
        <span
          className={`absolute right-3 top-3 rounded-full px-2.5 py-1 text-xs font-bold ${GRADE[p.deal.grade] ?? GRADE.D}`}
          title="Deal grade: value, income and growth outlook"
        >
          Deal {p.deal.grade}
        </span>

        <div className="absolute inset-x-0 bottom-0 p-3.5 text-white">
          <p className="text-2xl font-bold leading-none tracking-tight">
            {price.estimated && <span className="mr-0.5 font-normal text-white/60" title="HouseScout estimate — no price published">~</span>}
            {money(price.value)}
          </p>
          <p className="mt-1.5 truncate text-sm font-medium">{l.address}</p>
          <p className="truncate text-xs text-white/70">
            {l.suburb} · {l.property_type}
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-3 divide-x divide-slate-100 text-center">
        <Fact label="beds" value={l.bedrooms ?? "—"} />
        <Fact label="section" value={land ? `${Math.round(land)} m²` : "—"} />
        <Fact label="rooms to rent" value={rooms || "—"} accent={rooms >= 3} />
      </dl>
    </Link>
  );
}

function Fact({ label, value, accent }: { label: string; value: React.ReactNode; accent?: boolean }) {
  return (
    <div className="px-1 py-2.5">
      <dd className={`text-sm font-semibold tabular-nums ${accent ? "text-brand-dark" : "text-slate-900"}`}>{value}</dd>
      <dt className="text-[11px] text-slate-500">{label}</dt>
    </div>
  );
}
