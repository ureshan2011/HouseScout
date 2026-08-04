"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Listing } from "@/lib/api";
import { useProfile, scenarioInput } from "@/lib/useProfile";
import {
  NZ,
  StrategyId,
  WeeklyBreakdown,
  compareWeekly,
  equityTimeline,
  holdAnalysis,
  refinancePoint,
  simulate,
} from "@/lib/strategy";
import { StatusKey, money, compactMoney, signedWeekly, years as yearsWord } from "@/lib/viz";
import { Meter, Milestones, MoneyBar, TableView, Term, Verdict } from "@/components/viz/Primitives";
import { EquityChart } from "@/components/StrategyCharts";
import { usePrediction } from "@/components/ValuationPanel";
import { Gate } from "@/components/Gate";

/**
 * "What could I actually do with this house?" — the three realistic futures for
 * one listing, drawn rather than tabulated.
 *
 * Every figure comes from the same engine the Strategy Lab uses, seeded with this
 * listing's price and the model's rent forecast, so nothing here disagrees with
 * the numbers above it on the page.
 */
export function ListingScenarios({ listing }: { listing: Listing }) {
  const p = usePrediction(listing);
  const profile = useProfile();
  const [picked, setPicked] = useState<StrategyId>("payoff");

  const model = useMemo(() => {
    if (!p) return null;
    const price = listing.price ?? listing.price_estimate ?? profile.preapproval;
    const bedrooms = listing.bedrooms ?? 3;
    const horizon = profile.horizon_years;

    // The buyer's own numbers, with this listing's price and the model's
    // suburb-specific rent and growth on top.
    const input = scenarioInput(profile, {
      price,
      bedrooms,
      roomWeeklyRent: p.rent.perRoomWeekly,
      wholeHouseWeeklyRent: p.rent.wholeHouseWeekly,
      growthPct: p.growth.year1Pct,
      years: horizon,
    });
    const deposit = input.deposit;

    const weekly = compareWeekly(input).filter((w) => w.strategy !== "recycle");
    const timeline = equityTimeline({
      price, deposit,
      annualRate: profile.annual_rate,
      termYears: profile.term_years,
      growthPct: p.growth.year1Pct,
      years: horizon,
    });
    const refi = refinancePoint(timeline, { nextPrice: price, growthPct: p.growth.year1Pct });
    const payoff = simulate("payoff", input);
    const io = holdAnalysis({
      value: price, loan: Math.max(0, price - deposit),
      annualRate: profile.annual_rate, weeklyRent: p.rent.wholeHouseWeekly,
      interestOnly: true, termYears: profile.term_years,
      vacancyWeeks: profile.vacancy_weeks,
      ratesAnnual: profile.rates_annual,
      insuranceAnnual: profile.insurance_annual,
      maintenancePct: profile.maintenance_pct,
      managementPct: profile.management_pct,
      marginalTaxRate: profile.marginal_tax_rate,
    });

    const seed = new URLSearchParams({
      price: String(Math.round(price)),
      rent: String(Math.round(p.rent.wholeHouseWeekly)),
      room: String(Math.round(p.rent.perRoomWeekly)),
      beds: String(bedrooms),
      growth: String(p.growth.year1Pct),
    }).toString();

    return {
      input, weekly, timeline, refi, payoff, io, price, deposit, bedrooms, seed, horizon,
      rooms: Math.max(0, Math.min(bedrooms - 1, 4)),
      lvr: price > 0 ? ((price - deposit) / price) * 100 : 0,
      rateHeadroom: io.breakEvenRatePct - profile.annual_rate * 100,
      valueIn10: p.growth.valueIn10,
      growthPct: p.growth.year1Pct,
    };
  }, [p, listing, profile]);

  if (!model) return null;
  const chosen = model.weekly.find((w) => w.strategy === picked) ?? model.weekly[0];

  return (
    <section className="card p-4">
      <h2 className="flex items-center gap-2 font-semibold">
        <span aria-hidden>🔮</span> What you could do with it
      </h2>
      <p className="mb-4 mt-0.5 text-sm text-slate-500">
        Three realistic futures for this house, on a {money(model.deposit)} deposit.
      </p>

      <Gate
        feature="strategyLab"
        title="Scenarios for this property"
        blurb="See what this house costs you each week under three different plans, when its equity funds the next deposit, and what breaks it."
      >
        <div className="space-y-5">
          <div className="grid gap-3 md:grid-cols-3">
            {model.weekly.map((w) => (
              <ScenarioCard
                key={w.strategy}
                w={w}
                rooms={model.rooms}
                selected={picked === w.strategy}
                onSelect={() => setPicked(w.strategy)}
              />
            ))}
          </div>

          <div className="rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-900">
              Where the money goes each week
            </h3>
            <p className="mb-3 text-xs text-slate-500">{chosen.plain}</p>
            <MoneyBar
              income={chosen.incomeWeekly}
              incomeLabel={chosen.incomeLabel}
              segments={[
                { label: "Interest", weekly: chosen.interestWeekly },
                { label: "Loan repaid", weekly: chosen.principalWeekly },
                { label: "Rates, insurance, upkeep", weekly: chosen.runningWeekly },
                { label: "Tax", weekly: chosen.taxWeekly },
              ]}
              leftOver={chosen.netWeekly}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-slate-200 p-4">
              <h3 className="mb-3 text-sm font-semibold text-slate-900">Two things to watch</h3>
              <div className="space-y-4">
                <Meter
                  label="How much of it the bank owns"
                  value={model.lvr}
                  max={110}
                  limit={80}
                  limitLabel="80% is the usual limit"
                  display={`${model.lvr.toFixed(0)}%`}
                  status={model.lvr > 90 ? "critical" : model.lvr > 80 ? "warning" : "good"}
                  statusText={
                    model.lvr > 90 ? "Very little of it is yours"
                    : model.lvr > 80 ? "Above the standard limit"
                    : "Comfortable deposit"
                  }
                  hint={
                    <>
                      Your <Term k="LVR">LVR</Term> at settlement. Under 80% you can refinance
                      freely; above it, banks charge more and lend less.
                    </>
                  }
                />
                <Meter
                  label="Rate rise before the rent stops covering it"
                  value={Math.max(0, model.rateHeadroom)}
                  max={4}
                  display={`${model.rateHeadroom > 0 ? "+" : ""}${model.rateHeadroom.toFixed(1)} pts`}
                  status={
                    model.rateHeadroom > 1.5 ? "good" : model.rateHeadroom > 0 ? "warning" : "critical"
                  }
                  statusText={
                    model.rateHeadroom > 1.5 ? "Real breathing room"
                    : model.rateHeadroom > 0 ? "One rate cycle from trouble"
                    : "Rent already doesn't cover it"
                  }
                  hint={
                    <>
                      Rented out on <Term k="interest-only">interest-only</Term>, the rent stops
                      covering the interest and running costs at {model.io.breakEvenRatePct}%.
                    </>
                  }
                />
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 p-4">
              <h3 className="mb-1 text-sm font-semibold text-slate-900">If it grows at {model.growthPct}% a year</h3>
              <p className="mb-3 text-xs text-slate-500">
                Red is what you owe. Teal is the slice a bank would lend back to you.
              </p>
              <EquityChart rows={model.timeline} />
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 p-4">
            <h3 className="mb-1 text-sm font-semibold text-slate-900">Your next {model.horizon} years</h3>
            <p className="mb-4 text-xs text-slate-500">
              Living in it and putting the room rent onto the mortgage.
            </p>
            <Milestones
              horizon={model.horizon}
              items={[
                { year: 0, label: "You buy it", detail: `${money(model.deposit)} deposit`, reached: true },
                {
                  year: model.refi.year,
                  label: "Equity covers the next deposit",
                  detail: model.refi.year !== null ? `${money(model.refi.needed)} released` : `needs ${money(model.refi.needed)}`,
                  reached: model.refi.year !== null,
                },
                {
                  year: model.payoff.debtFreeYear,
                  label: "Mortgage gone",
                  detail: model.payoff.debtFreeYear !== null ? "no more repayments" : undefined,
                  reached: model.payoff.debtFreeYear !== null,
                },
              ]}
            />
            <TableView
              caption="Milestones"
              rows={[
                { label: "Deposit", value: money(model.deposit) },
                { label: "Loan at settlement", value: money(model.price - model.deposit) },
                { label: "Value in 10 years", value: money(model.valueIn10) },
                {
                  label: "Equity covers next deposit",
                  value: model.refi.year !== null ? yearsWord(model.refi.year) : `not within ${model.horizon} years`,
                },
                {
                  label: "Mortgage cleared",
                  value: model.payoff.debtFreeYear !== null ? yearsWord(model.payoff.debtFreeYear) : `not within ${model.horizon} years`,
                },
              ]}
            />
          </div>

          <Link href={`/strategy?${model.seed}`} className="btn-ghost">
            Change the assumptions in the Strategy Lab →
          </Link>
        </div>
      </Gate>
    </section>
  );
}

/** One future, as a card you can pick: headline number first, jargon never. */
function ScenarioCard({
  w,
  rooms,
  selected,
  onSelect,
}: {
  w: WeeklyBreakdown;
  rooms: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const TITLE: Record<StrategyId, string> = {
    payoff: "Live in it",
    recycle: "Live in it, save for the next",
    holdPI: "Rent it out",
    holdIO: "Rent it out, interest-only",
  };
  const SUB: Record<StrategyId, string> = {
    payoff: rooms > 0 ? `${rooms} spare room${rooms === 1 ? "" : "s"} let to boarders` : "no spare rooms to let",
    recycle: "keep the surplus as deposit money",
    holdPI: "one tenant, loan shrinking",
    holdIO: "one tenant, loan standing still",
  };

  const good = w.netWeekly >= 0;
  const status: StatusKey = w.netWeekly >= 50 ? "good" : w.netWeekly >= 0 ? "warning" : "critical";
  const verdict = w.netWeekly >= 50 ? "Pays for itself" : w.netWeekly >= 0 ? "Breaks even" : "Costs you";

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`rounded-xl border p-3 text-left transition ${
        selected ? "border-brand bg-brand/5 ring-1 ring-brand" : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
      }`}
    >
      <p className="text-sm font-semibold text-slate-900">{TITLE[w.strategy]}</p>
      <p className="mb-2 text-xs text-slate-500">{SUB[w.strategy]}</p>
      <p className={`text-2xl font-semibold ${good ? "text-emerald-700" : "text-rose-700"}`}>
        {signedWeekly(w.netWeekly)}
      </p>
      <p className="mb-2 text-xs text-slate-500">
        {good ? "in your pocket after every cost" : "out of your wages, every week"}
      </p>
      <Verdict status={status}>{verdict}</Verdict>
    </button>
  );
}
