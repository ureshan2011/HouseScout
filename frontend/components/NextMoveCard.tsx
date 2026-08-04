"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Listing, fmt } from "@/lib/api";
import { loadProfile } from "@/lib/criteria";
import { NZ, equityTimeline, holdAnalysis, refinancePoint } from "@/lib/strategy";
import { usePrediction } from "@/components/ValuationPanel";
import { Gate } from "@/components/Gate";

/**
 * The strategy view of one listing: could a tenant hold it, and when would it
 * fund the next deposit.
 *
 * Uses the same modelled rent and growth rate the rest of the listing page shows,
 * so the answer here agrees with the numbers above it.
 */
export function NextMoveCard({ listing }: { listing: Listing }) {
  const p = usePrediction(listing);

  const data = useMemo(() => {
    if (!p) return null;
    const profile = loadProfile();
    const price = listing.price ?? listing.price_estimate ?? profile.preapproval;
    const deposit = Math.min(profile.deposit, price);
    const loan = Math.max(0, price - deposit);
    const growthPct = p.growth.year1Pct;

    const io = holdAnalysis({
      value: price,
      loan,
      annualRate: profile.annual_rate,
      weeklyRent: p.rent.wholeHouseWeekly,
      interestOnly: true,
      termYears: profile.term_years,
    });

    const timeline = equityTimeline({
      price,
      deposit,
      annualRate: profile.annual_rate,
      termYears: profile.term_years,
      growthPct,
      years: 15,
    });
    const refi = refinancePoint(timeline, { nextPrice: price, growthPct });

    const seed = new URLSearchParams({
      price: String(Math.round(price)),
      rent: String(Math.round(p.rent.wholeHouseWeekly)),
      room: String(Math.round(p.rent.perRoomWeekly)),
      beds: String(listing.bedrooms ?? 3),
      growth: String(growthPct),
    });

    return {
      price, deposit, loan, io, refi, growthPct,
      weeklyRent: p.rent.wholeHouseWeekly,
      headroom: io.breakEvenRatePct - profile.annual_rate * 100,
      seed: seed.toString(),
    };
  }, [p, listing]);

  if (!data) return null;
  const { io, refi, headroom } = data;

  return (
    <section className="card p-4">
      <h2 className="mb-3 flex items-center gap-2 font-semibold">
        <span aria-hidden>♟️</span> Next move
      </h2>
      <Gate
        feature="strategyLab"
        title="Strategy view"
        blurb="Whether a tenant could hold this on interest-only, and when its equity would fund your next deposit."
      >
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Cell
              label="Rent vs interest"
              value={io.coversInterest ? "Covered" : "Short"}
              hint={`${io.interestCover.toFixed(2)}x cover on interest-only`}
              tone={io.coversInterest ? "good" : "bad"}
            />
            <Cell
              label="Break-even rate"
              value={`${io.breakEvenRatePct}%`}
              hint={`${headroom >= 0 ? "+" : ""}${headroom.toFixed(2)} pts of headroom`}
              tone={headroom > 1.5 ? "good" : headroom > 0 ? "warn" : "bad"}
            />
            <Cell
              label="Funds next deposit"
              value={refi.year !== null ? `year ${refi.year}` : "not in 15 yr"}
              hint={refi.year !== null ? `${fmt.money(refi.needed)} needed` : `at ${data.growthPct}%/yr growth`}
              tone={refi.year !== null && refi.year <= 7 ? "good" : "warn"}
            />
          </div>

          <p className="text-sm text-slate-600">
            On a {fmt.money(data.deposit)} deposit this carries {fmt.money(data.loan)} of debt. Let
            whole-house at {fmt.money(data.weeklyRent)}/wk, interest-only, it runs{" "}
            <strong className={io.weeklyAfterTax >= 0 ? "text-emerald-700" : "text-rose-700"}>
              {fmt.money(io.weeklyAfterTax)}/wk
            </strong>{" "}
            after rates, insurance, upkeep and tax
            {refi.year !== null && (
              <>
                , and its equity reaches {fmt.money(refi.needed)} — a{" "}
                {Math.round((1 - NZ.investorMaxLvr) * 100)}% investor deposit plus costs — in year{" "}
                {refi.year}
              </>
            )}
            .
          </p>

          <Link href={`/strategy?${data.seed}`} className="btn-ghost">
            Model this in the Strategy Lab →
          </Link>
        </div>
      </Gate>
    </section>
  );
}

function Cell({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone: "good" | "warn" | "bad";
}) {
  const bg = tone === "good" ? "bg-emerald-50" : tone === "warn" ? "bg-amber-50" : "bg-rose-50";
  const fg = tone === "good" ? "text-emerald-700" : tone === "warn" ? "text-amber-800" : "text-rose-700";
  return (
    <div className={`rounded-lg p-3 ${bg}`}>
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`text-lg font-bold ${fg}`}>{value}</p>
      <p className="text-xs text-slate-500">{hint}</p>
    </div>
  );
}
