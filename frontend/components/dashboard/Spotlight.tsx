"use client";

import Link from "next/link";
import { compactMoney, money } from "@/lib/viz";
import { displayPrice } from "@/lib/price";
import { PropertyImage } from "@/components/PropertyImage";
import { Row } from "./DashCard";

/**
 * The single best opportunity right now, given room to breathe: a full-bleed photo,
 * the reasons it ranks, and the four numbers a buyer asks about first. The reasons come
 * from the same deal score as Deal Radar, so nothing here is written for show.
 */
export function Spotlight({ row, brief }: { row: Row; brief: string }) {
  const { l, p } = row;
  const price = displayPrice(l);
  const stats = [
    { label: "Room rent", value: `~$${p.rent.perRoomWeekly}/wk`, hint: "per boarder" },
    { label: "Gross yield", value: `${p.rent.yieldPct}%`, hint: "whole house" },
    { label: "In 10 years", value: compactMoney(p.growth.valueIn10), hint: "modelled" },
    { label: "Offer ceiling", value: compactMoney(p.negotiation.ceiling), hint: "most worth paying" },
  ];

  return (
    <section
      aria-label="Top opportunity"
      className="overflow-hidden rounded-3xl bg-slate-950 text-white shadow-lg ring-1 ring-black/10 md:grid md:grid-cols-[1.15fr_1fr]"
    >
      <div className="relative aspect-[4/3] md:aspect-auto md:min-h-[22rem]">
        <div className="absolute inset-0">
          <PropertyImage listing={l} />
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/20 to-transparent md:bg-gradient-to-r md:from-transparent md:via-transparent md:to-slate-950" />
        <span className="absolute left-4 top-4 rounded-full bg-white/90 px-3 py-1 text-xs font-bold uppercase tracking-wider text-slate-900 backdrop-blur">
          ✨ Top opportunity
        </span>
      </div>

      <div className="space-y-4 p-5 md:p-7">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-teal-300">{brief}</p>
          <h2 className="mt-1 text-2xl font-bold leading-tight tracking-tight">{l.address}</h2>
          <p className="text-sm text-slate-300">
            {l.suburb} · {l.bedrooms} bed · {l.bathrooms} bath
            {l.land_area_m2 ? ` · ${Math.round(l.land_area_m2)} m²` : ""}
          </p>
        </div>

        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="text-4xl font-bold tracking-tight">
            {price.estimated && <span className="mr-1 text-2xl font-normal text-slate-400">~</span>}
            {money(price.value)}
          </p>
          <span className="rounded-full bg-teal-400/15 px-2.5 py-1 text-xs font-bold text-teal-300">
            Deal {p.deal.grade} · {p.deal.score}/100
          </span>
        </div>
        {price.estimated && (
          <p className="-mt-2 text-xs text-slate-400">
            {l.price_text || "No price published"} — this is HouseScout&apos;s estimate, not an asking price.
          </p>
        )}

        <ul className="space-y-1 text-sm text-slate-200">
          {p.deal.reasons.slice(0, 3).map((r) => (
            <li key={r} className="flex gap-2">
              <span aria-hidden className="text-teal-300">
                ✓
              </span>
              {r}
            </li>
          ))}
        </ul>

        <dl className="grid grid-cols-2 gap-2">
          {stats.map((s) => (
            <div key={s.label} className="rounded-xl bg-white/[0.07] px-3 py-2.5 ring-1 ring-white/10">
              <dt className="text-[11px] uppercase tracking-wide text-slate-400">{s.label}</dt>
              <dd className="text-lg font-bold tabular-nums">{s.value}</dd>
              <dd className="text-[11px] text-slate-500">{s.hint}</dd>
            </div>
          ))}
        </dl>

        <div className="flex gap-2 pt-1">
          <Link href={`/listings/${l.id}`} className="btn flex-1 !bg-teal-400 !text-slate-950 hover:!bg-teal-300">
            See the full picture
          </Link>
          {l.url && (
            <a
              href={l.url}
              target="_blank"
              rel="noreferrer"
              className="btn-ghost !border-white/25 !text-white hover:!bg-white/10"
              aria-label="Open the original listing in a new tab"
            >
              Listing ↗
            </a>
          )}
        </div>
      </div>
    </section>
  );
}
