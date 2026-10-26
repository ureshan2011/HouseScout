"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { loadModel, predict } from "@/lib/predict";
import { useProfile } from "@/lib/useProfile";
import { compactMoney, money } from "@/lib/viz";
import {
  SaleMethod,
  closesLabel,
  closingDate,
  daysUntil,
  effectivePrice,
  median,
  priceBands,
  saleMethod,
  suburbRows,
} from "@/lib/dashboard";
import { Row } from "@/components/dashboard/DashCard";
import { Rail, RailItem } from "@/components/dashboard/Rail";
import { Spotlight } from "@/components/dashboard/Spotlight";
import { Pulse, PulseSkeleton } from "@/components/dashboard/Pulse";
import { PriceBands, SaleMethods, SuburbValue } from "@/components/dashboard/MarketInsights";

// The home page is the market read as one picture: what is for sale, what it costs, how
// it is being sold, where the value is — then the houses themselves, grouped by the
// question a buyer is asking (does it fit? is it closing? is it new?).
//
// Everything is computed here from the same listings, scoring and valuation model the
// rest of the app uses; there is no figure on this page that Deal Radar or the listing
// page would disagree with.

const CLOSING_WINDOW_DAYS = 21;

/** Every listing, past the 200-per-call cap that `api.listings` applies. */
async function loadAll() {
  const qs = "?passes_only=false&limit=200";
  const out = [];
  for (let offset = 0; ; offset += 200) {
    const page = await api.listings(`${qs}&offset=${offset}`);
    out.push(...page);
    if (page.length < 200) return out;
  }
}

function greeting(d: Date): string {
  const h = d.getHours();
  return h < 5 ? "Burning the midnight oil" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export default function Dashboard() {
  const profile = useProfile();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState<Date | null>(null);

  // The date is read on the client only: the page is statically exported, so a date
  // baked in at build time would be wrong for every visitor after the first day.
  useEffect(() => setNow(new Date()), []);

  // Scores depend on the buyer's numbers, so a change from the header re-runs this.
  useEffect(() => {
    let alive = true;
    Promise.all([loadAll(), loadModel()])
      .then(([ls, m]) => alive && setRows(ls.map((l) => ({ l, p: predict(l, m) }))))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [profile]);

  const d = useMemo(() => {
    if (!rows || !now) return null;
    const budget = profile.max_price;
    const fits = rows.filter((r) => r.l.score?.passes_filters);
    const prices = rows.map((r) => effectivePrice(r.l)).filter((p): p is number => p != null);

    const methods: Record<SaleMethod, number> = { published: 0, auction: 0, deadline: 0, negotiation: 0 };
    for (const r of rows) methods[saleMethod(r.l)]++;

    const closing = rows
      .map((r) => ({ r, date: closingDate(r.l, now) }))
      .filter((x): x is { r: Row; date: Date } => x.date != null)
      .map((x) => ({ ...x, days: daysUntil(x.date, now) }))
      .filter((x) => x.days >= 0 && x.days <= CLOSING_WINDOW_DAYS)
      .sort((a, b) => a.days - b.days);

    // Only Trade Me reports a listing date; realestate.co.nz rows carry 0, meaning unknown.
    const fresh = rows
      .filter((r) => r.l.source.includes("trademe") && r.l.days_on_market != null && r.l.days_on_market <= 7)
      .sort((a, b) => (a.l.days_on_market ?? 0) - (b.l.days_on_market ?? 0));

    const byDeal = [...rows].sort((a, b) => b.p.deal.score - a.p.deal.score);
    // The spotlight should be something the buyer could plausibly afford.
    const spot = byDeal.find((r) => (effectivePrice(r.l) ?? Infinity) <= budget * 1.2) ?? byDeal[0];

    const roomy = rows
      .filter((r) => (r.l.bedrooms ?? 0) >= 4 && (effectivePrice(r.l) ?? Infinity) <= budget * 1.3)
      .sort((a, b) => (effectivePrice(a.l) ?? 0) - (effectivePrice(b.l) ?? 0));

    return {
      budget,
      total: rows.length,
      fits: [...fits].sort((a, b) => (b.l.score?.match_score ?? 0) - (a.l.score?.match_score ?? 0)),
      bySource: {
        trademe: rows.filter((r) => r.l.source.includes("trademe")).length,
        realestate: rows.filter((r) => r.l.source.includes("realestate")).length,
      },
      medianPrice: median(prices),
      published: methods.published,
      methods,
      closing,
      fresh,
      byDeal,
      spot,
      roomy,
      bands: priceBands(prices, budget),
      suburbs: suburbRows(
        rows.map((r) => ({
          suburb: r.l.suburb,
          price: effectivePrice(r.l),
          deal: r.p.deal.score,
          yieldPct: r.p.rent.yieldPct,
        })),
      ),
    };
  }, [rows, now, profile.max_price]);

  if (failed)
    return (
      <div className="card p-6">
        <p className="font-semibold text-amber-600">Couldn&apos;t load the market</p>
        <p className="mt-1 text-sm text-slate-600">
          Listings come from the build-time scrape. Try refreshing the page.
        </p>
      </div>
    );

  const brief = [
    `≤ ${compactMoney(profile.max_price)}`,
    profile.require_garage && "garage",
    profile.require_backyard && "backyard",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-7 md:space-y-9">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <p className="text-sm font-medium text-brand-dark" suppressHydrationWarning>
            {now ? `${greeting(now)} · ${now.toLocaleDateString("en-NZ", { weekday: "long", day: "numeric", month: "long" })}` : " "}
          </p>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Christchurch, right now</h1>
        </div>
        <Link
          href="/settings"
          className="press inline-flex min-h-[2.75rem] items-center gap-2 rounded-full bg-white px-4 text-sm shadow-sm ring-1 ring-slate-200 md:min-h-0 md:py-1.5"
        >
          <span className="text-slate-500">Your brief</span>
          <span className="font-semibold text-slate-900">{brief}</span>
          <span aria-hidden className="text-slate-400">
            ›
          </span>
        </Link>
      </header>

      {!d ? (
        <PulseSkeleton />
      ) : (
        <>
          <Pulse
            tiles={[
              {
                icon: "🏠",
                label: "Homes on the market",
                value: String(d.total),
                note: `${d.bySource.trademe} on Trade Me · ${d.bySource.realestate} on realestate.co.nz`,
              },
              {
                icon: "🎯",
                label: "Fit your brief",
                value: String(d.fits.length),
                note: d.fits.length ? `of ${d.total} clear your filters` : "none clear your filters yet",
              },
              {
                icon: "💰",
                label: "Median price",
                value: money(d.medianPrice),
                note: `${Math.round((d.published / d.total) * 100)}% publish a price; the rest are estimates`,
              },
              {
                icon: "⏰",
                label: `Closing in ${CLOSING_WINDOW_DAYS} days`,
                value: String(d.closing.length),
                note: "auctions and deadline sales",
                accent: "rose",
              },
            ]}
          />

          {d.spot && <Spotlight row={d.spot} brief={d.fits.some((r) => r.l.id === d.spot.l.id) ? "Fits your brief" : "Best value in reach"} />}

          <div className="grid gap-4 lg:grid-cols-3">
            <PriceBands bands={d.bands} budget={d.budget} total={d.total} />
            <SaleMethods counts={d.methods} total={d.total} />
            <SuburbValue rows={d.suburbs} />
          </div>

          {d.fits.length > 0 ? (
            <Rail
              title="Fits your brief"
              subtitle={`Clears ${brief} — best match first`}
              href="/listings"
              hrefLabel="All matches"
              items={d.fits.slice(0, 8).map<RailItem>((r) => ({ row: r, tag: `Match ${Math.round(r.l.score?.match_score ?? 0)}` }))}
            />
          ) : (
            <section className="card p-5">
              <h2 className="font-bold">Nothing clears your brief today</h2>
              <p className="mt-1 text-sm text-slate-600">
                {d.total} homes are on the market, but none are under {compactMoney(profile.max_price)} with
                everything you asked for. Raising the price cap under <strong>💰 Your numbers</strong> is the
                quickest way to see what&apos;s just out of reach.
              </p>
            </section>
          )}

          <Rail
            title="Closing soon"
            subtitle="Auctions and deadline sales ending in the next three weeks"
            href="/listings?passes_only=false"
            items={d.closing.slice(0, 8).map<RailItem>((x) => ({
              row: x.r,
              tag: `Closes ${closesLabel(x.days)}`,
              tone: x.days <= 3 ? "alert" : "dark",
            }))}
          />

          <Rail
            title="Best opportunities"
            subtitle="Value, rent and growth — ranked by Deal Radar"
            href="/radar"
            hrefLabel="Deal Radar"
            items={d.byDeal.slice(0, 8).map<RailItem>((r) => ({ row: r, tag: `${r.p.deal.score}/100` }))}
          />

          <Rail
            title="New on Trade Me"
            subtitle="Listed in the last week"
            href="/listings?sort=newest&passes_only=false"
            items={d.fresh.slice(0, 8).map<RailItem>((r) => ({
              row: r,
              tag: r.l.days_on_market ? `${r.l.days_on_market} days ago` : "Today",
            }))}
          />

          <Rail
            title="Room to rent"
            subtitle="Four or more bedrooms, near your budget — cheapest first"
            href="/listings?min_bedrooms=4&passes_only=false"
            items={d.roomy.slice(0, 8).map<RailItem>((r) => ({
              row: r,
              tag: `${Math.min((r.l.bedrooms ?? 1) - 1, 4)} rooms to let`,
            }))}
          />

          <p className="pb-2 text-center text-xs text-slate-400">
            Prices marked ~ are HouseScout estimates, not asking prices. Indicative only — not a valuation or
            financial advice.
          </p>
        </>
      )}
    </div>
  );
}
