"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { fmt } from "@/lib/api";
import { loadProfile } from "@/lib/criteria";
import {
  Comparison,
  NZ,
  SimInput,
  StrategyId,
  borrowingCapacity,
  compareStrategies,
  equityTimeline,
  holdAnalysis,
  refinancePoint,
  simulate,
  stressTest,
} from "@/lib/strategy";
import { Gate } from "@/components/Gate";
import { EquityChart, NetWorthChart, ShockChart } from "@/components/StrategyCharts";

type Inputs = SimInput & { nextPrice: number };

const TABS = [
  { id: "capacity", label: "What you can borrow" },
  { id: "compare", label: "Compare strategies" },
  { id: "equity", label: "Equity & refinance" },
  { id: "hold", label: "Holding it" },
  { id: "portfolio", label: "Portfolio plan" },
  { id: "stress", label: "Stress test" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function StrategyPage() {
  const [tab, setTab] = useState<TabId>("capacity");
  const [f, setF] = useState<Inputs>({
    price: 450_000,
    nextPrice: 450_000,
    deposit: 90_000,
    annualRate: 0.055,
    termYears: 30,
    bedrooms: 4,
    roomWeeklyRent: 240,
    wholeHouseWeeklyRent: 620,
    growthPct: 5,
    grossIncome: 120_000,
    years: 20,
    interestOnlyYears: 5,
    marginalTaxRate: 0.33,
  });

  useEffect(() => {
    const p = loadProfile();
    // A listing can hand its own numbers over via the query string, so "model this
    // property" lands here with the right price and rent instead of the defaults.
    const q = new URLSearchParams(window.location.search);
    const n = (key: string) => {
      const v = Number(q.get(key));
      return Number.isFinite(v) && v > 0 ? v : null;
    };
    const price = n("price");
    setF((s) => ({
      ...s,
      price: price ?? p.preapproval ?? s.price,
      nextPrice: price ?? p.preapproval ?? s.nextPrice,
      deposit: p.deposit,
      annualRate: p.annual_rate,
      termYears: p.term_years,
      roomWeeklyRent: n("room") ?? p.weekly_rent,
      wholeHouseWeeklyRent: n("rent") ?? s.wholeHouseWeeklyRent,
      bedrooms: n("beds") ?? s.bedrooms,
      growthPct: n("growth") ?? s.growthPct,
    }));
  }, []);

  const set = <K extends keyof Inputs>(k: K, v: Inputs[K]) => setF((s) => ({ ...s, [k]: v }));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Strategy Lab</h1>
        <p className="text-sm text-slate-500">
          What happens after you buy — and what stops you buying again.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        <div className="card h-fit space-y-3 p-4 lg:sticky lg:top-20">
          <Num label="Purchase price" value={f.price} onChange={(v) => set("price", v)} step={5000} />
          <Num label="Deposit" value={f.deposit} onChange={(v) => set("deposit", v)} step={5000} />
          <Num label="Household income (gross)" value={f.grossIncome} onChange={(v) => set("grossIncome", v)} step={5000} />
          <Range label={`Rate ${(f.annualRate * 100).toFixed(2)}%`} min={0.03} max={0.1} step={0.0005} value={f.annualRate} onChange={(v) => set("annualRate", v)} />
          <Range label={`Term ${f.termYears} yr`} min={10} max={30} step={1} value={f.termYears} onChange={(v) => set("termYears", v)} />
          <Num label="Bedrooms" value={f.bedrooms} onChange={(v) => set("bedrooms", v)} step={1} />
          <Num label="Room rent / week" value={f.roomWeeklyRent} onChange={(v) => set("roomWeeklyRent", v)} step={10} />
          <Num label="Whole-house rent / week" value={f.wholeHouseWeeklyRent} onChange={(v) => set("wholeHouseWeeklyRent", v)} step={10} />
          <Range label={`Capital growth ${f.growthPct}%/yr`} min={0} max={10} step={0.5} value={f.growthPct} onChange={(v) => set("growthPct", v)} />
          <Range label={`Horizon ${f.years} yr`} min={5} max={30} step={1} value={f.years ?? 20} onChange={(v) => set("years", v)} />
          <Num label="Next property price (today)" value={f.nextPrice} onChange={(v) => set("nextPrice", v)} step={10000} />
          <Range label={`Interest-only period ${f.interestOnlyYears} yr`} min={0} max={10} step={1} value={f.interestOnlyYears ?? 5} onChange={(v) => set("interestOnlyYears", v)} />
          <p className="border-t border-slate-100 pt-3 text-xs text-slate-400">
            Seeded from your <Link href="/settings" className="underline">buyer profile</Link>.
            Rates, insurance and maintenance use NZ defaults.
          </p>
        </div>

        <div className="space-y-4">
          <nav className="flex flex-wrap gap-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  tab === t.id ? "bg-brand text-white" : "bg-white text-slate-600 hover:bg-slate-100"
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>

          {tab === "capacity" && <CapacityTab f={f} />}
          {tab === "compare" && <CompareTab f={f} />}
          {tab === "equity" && <EquityTab f={f} />}
          {tab === "hold" && <HoldTab f={f} />}
          {tab === "portfolio" && <PortfolioTab f={f} />}
          {tab === "stress" && <StressTab f={f} />}
        </div>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------- //
// What you can borrow
// --------------------------------------------------------------------------- //
function CapacityTab({ f }: { f: Inputs }) {
  const owner = useMemo(
    () =>
      borrowingCapacity({
        grossIncome: f.grossIncome,
        deposit: f.deposit,
        annualRate: f.annualRate,
        termYears: f.termYears,
      }),
    [f],
  );
  const investor = useMemo(
    () =>
      borrowingCapacity({
        grossIncome: f.grossIncome,
        deposit: f.deposit,
        annualRate: f.annualRate,
        termYears: f.termYears,
        isInvestor: true,
      }),
    [f],
  );

  const BINDING: Record<string, string> = {
    deposit: "Save more, or buy under the LVR limit with a First Home Loan or a new build.",
    DTI: "The DTI cap bites before the deposit does. More income or less other debt is the only lever.",
    servicing: "The bank's stressed-rate test bites first. Clearing consumer debt and card limits helps most.",
  };

  return (
    <div className="space-y-4">
      <section className="card p-4">
        <h2 className="font-semibold">Three tests, and you have to pass all three</h2>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <CapacityCard title="As an owner-occupier" c={owner} maxLvr={NZ.ownerOccupierMaxLvr} />
          <CapacityCard title="As an investor" c={investor} maxLvr={NZ.investorMaxLvr} />
        </div>
        <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          <strong>Binding constraint: {owner.limitedBy}.</strong> {BINDING[owner.limitedBy]}
        </p>
      </section>

      <section className="card p-4 text-sm text-slate-700">
        <h2 className="mb-2 font-semibold">The rules behind these numbers</h2>
        <ul className="ml-5 list-disc space-y-1.5">
          <li><strong>LVR</strong> — {Math.round(NZ.ownerOccupierMaxLvr * 100)}% for owner-occupiers, {Math.round(NZ.investorMaxLvr * 100)}% for investors on existing stock, {Math.round(NZ.newBuildInvestorMaxLvr * 100)}% on new builds. Banks can go past it for a small share of lending.</li>
          <li><strong>DTI</strong> — total debt capped at {NZ.dtiOwnerOccupier}x gross income for owner-occupiers, {NZ.dtiInvestor}x for investors. New builds are exempt.</li>
          <li><strong>Servicing</strong> — tested at about {(NZ.servicingBuffer * 100).toFixed(0)} points above the offered rate ({owner.testRatePct}% here), with rent counted at {Math.round(NZ.rentShading * 100)}%.</li>
          <li><strong>Boarder income</strong> — tax-free up to the IRD threshold, but most banks won&apos;t count it for servicing. It helps you pay the loan; it won&apos;t get you the loan.</li>
        </ul>
      </section>
    </div>
  );
}

function CapacityCard({
  title,
  c,
  maxLvr,
}: {
  title: string;
  c: ReturnType<typeof borrowingCapacity>;
  maxLvr: number;
}) {
  const bars = [
    { label: `Deposit (${Math.round(maxLvr * 100)}% LVR)`, value: c.depositHeadroom },
    { label: `DTI (${c.dtiCap}x income)`, value: c.dtiHeadroom },
    { label: `Servicing @ ${c.testRatePct}%`, value: c.servicingHeadroom },
  ];
  const max = Math.max(...bars.map((b) => b.value), 1);
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <p className="text-xs uppercase tracking-wide text-slate-500">{title}</p>
      <p className="text-2xl font-bold">{fmt.money(c.maxPurchase)}</p>
      <p className="mb-3 text-xs text-slate-500">
        {fmt.money(c.maxLoan)} loan — limited by {c.limitedBy}
      </p>
      {bars.map((b) => (
        <div key={b.label} className="mb-1.5">
          <div className="flex justify-between text-xs">
            <span className="text-slate-600">{b.label}</span>
            <span className="tabular-nums text-slate-500">{fmt.money(b.value)}</span>
          </div>
          <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-slate-200">
            <div
              className={`h-full ${b.value === c.maxLoan ? "bg-rose-500" : "bg-brand"}`}
              style={{ width: `${(b.value / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// --------------------------------------------------------------------------- //
// Compare strategies
// --------------------------------------------------------------------------- //
function CompareTab({ f }: { f: Inputs }) {
  const rows = useMemo(() => compareStrategies(f), [f]);
  return (
    <Gate
      feature="strategyLab"
      title="Strategy Lab"
      blurb="Four ways to play the same purchase, run through the same maths, taxes and costs — so the comparison is real."
    >
      <div className="space-y-4">
        <section className="card overflow-x-auto p-4">
          <h2 className="mb-1 font-semibold">Same house, four plays, {f.years} years</h2>
          <p className="mb-3 text-xs text-slate-500">
            Ranked by net worth at the horizon. The highest number is not automatically the right answer.
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-400 [&>th]:whitespace-nowrap [&>th]:pr-4">
                <th className="py-2">Strategy</th>
                <th>Net worth</th>
                <th>Debt</th>
                <th>Props</th>
                <th>Cashflow/wk</th>
                <th>LVR</th>
                <th>Debt-free</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.strategy} className="border-t border-slate-100 [&>td]:whitespace-nowrap [&>td]:pr-4">
                  <td className="py-2 pr-3 font-medium">
                    {i === 0 && <span className="badge mr-1 bg-emerald-100 text-emerald-800">top</span>}
                    {r.label}
                  </td>
                  <td className="font-semibold">{fmt.money(r.netWorth)}</td>
                  <td>{fmt.money(r.debt)}</td>
                  <td>{r.properties}</td>
                  <td className={r.weeklyCashflow >= 0 ? "text-emerald-700" : "text-rose-700"}>
                    {fmt.money(r.weeklyCashflow)}
                  </td>
                  <td>{r.lvr}%</td>
                  <td>{r.debtFreeYear ? `yr ${r.debtFreeYear}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <div className="grid gap-4 md:grid-cols-2">
          {rows.map((r) => (
            <TradeoffCard key={r.strategy} r={r} />
          ))}
        </div>
      </div>
    </Gate>
  );
}

function TradeoffCard({ r }: { r: Comparison }) {
  return (
    <section className="card p-4">
      <h3 className="font-medium">{r.label}</h3>
      <p className="mt-1 text-sm text-slate-600">{r.tradeoff}</p>
      <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-500">
        <span>Interest paid <strong className="text-slate-700">{fmt.money(r.totalInterest)}</strong></span>
        <span>Equity <strong className="text-slate-700">{fmt.money(r.equity)}</strong></span>
      </div>
    </section>
  );
}

// --------------------------------------------------------------------------- //
// Equity & refinance
// --------------------------------------------------------------------------- //
function EquityTab({ f }: { f: Inputs }) {
  const { rows, refi, refiIO } = useMemo(() => {
    const base = {
      price: f.price,
      deposit: f.deposit,
      annualRate: f.annualRate,
      termYears: f.termYears,
      growthPct: f.growthPct,
      years: f.years ?? 20,
    };
    const rows = equityTimeline(base);
    const io = equityTimeline({ ...base, interestOnlyYears: f.interestOnlyYears ?? 5 });
    const opts = { nextPrice: f.nextPrice, growthPct: f.growthPct };
    return { rows, refi: refinancePoint(rows, opts), refiIO: refinancePoint(io, opts) };
  }, [f]);

  return (
    <Gate
      feature="strategyLab"
      title="Equity timeline"
      blurb="When your equity covers the next deposit, and what the top-up does to your loan."
    >
      <div className="space-y-4">
        <section className="card p-4">
          <h2 className="mb-1 font-semibold">When you can buy again</h2>
          <p className="mb-3 text-xs text-slate-500">
            Banks release equity to {Math.round(NZ.releaseLvr * 100)}% of value, so releasable equity is
            always less than the equity you own.
          </p>
          {refi.year !== null ? (
            <div className="grid gap-3 sm:grid-cols-4">
              <Stat label="Ready in" value={`${refi.year} yr`} accent />
              <Stat label="Releasable then" value={fmt.money(refi.usableEquity)} />
              <Stat label="Deposit + costs needed" value={fmt.money(refi.needed)} />
              <Stat label="Loan after top-up" value={fmt.money(refi.loanAfterRelease)} hint={`${refi.lvrAfterRelease}% LVR`} />
            </div>
          ) : (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              At {f.growthPct}% growth this property never releases the {fmt.money(refi.needed)} needed
              for a {fmt.money(f.nextPrice)} deposit inside {f.years} years. Lower the next purchase
              price, pay down faster, or wait for more growth.
            </p>
          )}
          <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
            The release is a bigger mortgage, not a windfall. You&apos;d go from{" "}
            {fmt.money(f.price - f.deposit)} of debt to {fmt.money(refi.loanAfterRelease)} on this house
            alone, and the repayments come out of the same pay packet.
          </p>
        </section>

        <section className="card p-4">
          <h2 className="mb-3 font-semibold">Debt, locked equity and releasable equity</h2>
          <EquityChart rows={rows} />
        </section>

        <section className="card p-4">
          <h2 className="mb-2 font-semibold">Interest-only changes the timing</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Stat label="Ready in (P&I)" value={refi.year !== null ? `${refi.year} yr` : "not in horizon"} />
            <Stat
              label={`Ready in (${f.interestOnlyYears} yr interest-only first)`}
              value={refiIO.year !== null ? `${refiIO.year} yr` : "not in horizon"}
            />
          </div>
          <p className="mt-3 text-sm text-slate-600">
            On interest-only the balance never moves, so every dollar of equity has to come from
            capital growth. It frees up cash now and pushes the next purchase out — unless the market
            runs, in which case the difference is small and the cashflow is worth having.
          </p>
        </section>
      </div>
    </Gate>
  );
}

// --------------------------------------------------------------------------- //
// Holding it
// --------------------------------------------------------------------------- //
function HoldTab({ f }: { f: Inputs }) {
  const loan = Math.max(0, f.price - f.deposit);
  const io = useMemo(
    () =>
      holdAnalysis({
        value: f.price, loan, annualRate: f.annualRate, weeklyRent: f.wholeHouseWeeklyRent,
        interestOnly: true, termYears: f.termYears, marginalTaxRate: f.marginalTaxRate,
      }),
    [f, loan],
  );
  const pi = useMemo(
    () =>
      holdAnalysis({
        value: f.price, loan, annualRate: f.annualRate, weeklyRent: f.wholeHouseWeeklyRent,
        interestOnly: false, termYears: f.termYears, marginalTaxRate: f.marginalTaxRate,
      }),
    [f, loan],
  );

  const headroom = io.breakEvenRatePct - f.annualRate * 100;

  return (
    <div className="space-y-4">
      <section className="card p-4">
        <h2 className="mb-1 font-semibold">Can the tenant hold it?</h2>
        <p className="mb-3 text-xs text-slate-500">
          {fmt.money(loan)} of debt, {fmt.money(f.wholeHouseWeeklyRent)}/wk rent, 3 weeks vacancy allowed.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <HoldCard title="Interest-only" h={io} />
          <HoldCard title="Principal & interest" h={pi} />
        </div>
      </section>

      <section className="card p-4">
        <h2 className="mb-3 font-semibold">Where it breaks</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Break-even rate" value={`${io.breakEvenRatePct}%`} hint={`you're at ${(f.annualRate * 100).toFixed(2)}%`} accent={headroom > 0} />
          <Stat label="Rate headroom" value={`${headroom.toFixed(2)} pts`} />
          <Stat label="Break-even rent" value={`${fmt.money(io.breakEvenRentWeekly)}/wk`} />
        </div>
        <p className="mt-3 text-sm text-slate-600">
          {headroom > 1.5
            ? `Rates would have to reach ${io.breakEvenRatePct}% before the rent stops covering interest and running costs. That is real headroom.`
            : headroom > 0
              ? `Only ${headroom.toFixed(2)} points of headroom. One rate cycle and you are topping this up from your salary every week.`
              : `The rent already doesn't cover interest and running costs. You are funding ${fmt.money(Math.abs(io.weeklyAfterTax))}/wk from your salary before anything goes wrong.`}
        </p>
      </section>

      <section className="card p-4 text-sm text-slate-700">
        <h2 className="mb-2 font-semibold">Tax, honestly</h2>
        <ul className="ml-5 list-disc space-y-1.5">
          <li>Rental interest is 100% deductible again from 1 April 2025.</li>
          <li>A net rental loss is ring-fenced: it carries forward against future rental income and cannot reduce tax on your salary.</li>
          <li>Principal repayments are not deductible — only the interest part is.</li>
          <li>Sell inside {NZ.brightLineYears} years and the gain is taxed under the bright-line test.</li>
          <li>Boarders in your own home are different: income up to the IRD standard-cost threshold per boarder is effectively tax-free, up to 4 boarders.</li>
        </ul>
      </section>
    </div>
  );
}

function HoldCard({ title, h }: { title: string; h: ReturnType<typeof holdAnalysis> }) {
  const ok = h.afterTaxCashflow >= 0;
  return (
    <div className={`rounded-lg p-3 ${ok ? "bg-emerald-50" : "bg-rose-50"}`}>
      <p className="text-xs uppercase tracking-wide text-slate-500">{title}</p>
      <p className={`text-2xl font-bold ${ok ? "text-emerald-700" : "text-rose-700"}`}>
        {fmt.money(h.weeklyAfterTax)}/wk
      </p>
      <p className="mb-2 text-xs text-slate-500">after tax, after every cost</p>
      <dl className="space-y-1 text-xs">
        <Row k="Rent (net of vacancy)" v={fmt.money(h.annualRent)} />
        <Row k="Interest" v={`−${fmt.money(h.annualInterest)}`} />
        <Row k="Principal" v={h.annualPrincipal ? `−${fmt.money(h.annualPrincipal)}` : "—"} />
        <Row k="Rates, insurance, upkeep" v={`−${fmt.money(h.annualOpex)}`} />
        <Row k="Tax" v={h.tax ? `−${fmt.money(h.tax)}` : "nil"} />
        {h.ringFencedLoss > 0 && <Row k="Loss carried forward" v={fmt.money(h.ringFencedLoss)} />}
      </dl>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-slate-600">{k}</dt>
      <dd className="tabular-nums font-medium">{v}</dd>
    </div>
  );
}

// --------------------------------------------------------------------------- //
// Portfolio plan
// --------------------------------------------------------------------------- //
const BLOCK_LABEL: Record<string, string> = {
  equity: "Not enough releasable equity",
  DTI: "Over the debt-to-income cap",
  servicing: "Fails the stressed-rate servicing test",
};

/** "Over the DTI cap — $322k short on a $821k purchase". */
function blockText(y: { blockedBy: string | null; blockedShortfall: number; nextPrice: number }) {
  if (!y.blockedBy) return "";
  return `${BLOCK_LABEL[y.blockedBy]} — ${fmt.money(y.blockedShortfall)} short on a ${fmt.money(y.nextPrice)} purchase`;
}

function PortfolioTab({ f }: { f: Inputs }) {
  const sim = useMemo(() => simulate("recycle", f), [f]);
  const blockers = useMemo(() => {
    const counts = new Map<string, number>();
    for (const y of sim.years) if (y.blockedBy) counts.set(y.blockedBy, (counts.get(y.blockedBy) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [sim]);

  return (
    <Gate
      feature="portfolioPlan"
      title="Portfolio plan"
      blurb="Year-by-year equity recycling — every purchase funded by a top-up, with DTI and servicing checked before each one."
    >
      <div className="space-y-4">
        <section className="card p-4">
          <h2 className="mb-3 font-semibold">Where {f.years} years of recycling gets you</h2>
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label="Properties" value={String(sim.final.properties)} accent />
            <Stat label="Portfolio value" value={fmt.money(sim.final.portfolioValue)} />
            <Stat label="Debt" value={fmt.money(sim.final.debt)} hint={`${sim.final.lvr}% LVR`} />
            <Stat label="Net worth" value={fmt.money(sim.final.netWorth)} />
          </div>
          {sim.acquisitions.length === 0 && (
            <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              On these numbers you never buy the second one.{" "}
              {blockers.length > 0 && (
                <>
                  In {blockers[0][1]} of {f.years} years the blocker is{" "}
                  <strong>{BLOCK_LABEL[blockers[0][0]].toLowerCase()}</strong>.{" "}
                </>
              )}
              Try a cheaper second property, more income, or a longer horizon — the DTI cap counts
              the full purchase price, not just the deposit.
            </p>
          )}
        </section>

        <section className="card p-4">
          <h2 className="mb-3 font-semibold">Net worth and debt</h2>
          <NetWorthChart years={sim.years} />
        </section>

        <section className="card overflow-x-auto p-4">
          <h2 className="mb-3 font-semibold">Year by year</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-400 [&>th]:whitespace-nowrap [&>th]:pr-4">
                <th className="py-2">Yr</th>
                <th>Props</th>
                <th>Value</th>
                <th>Debt</th>
                <th>Net worth</th>
                <th>LVR</th>
                <th>DTI</th>
                <th>Cash/wk</th>
                <th>Event</th>
              </tr>
            </thead>
            <tbody>
              {sim.years.map((y) => (
                <tr key={y.year} className={`border-t border-slate-100 [&>td]:whitespace-nowrap [&>td]:pr-4 ${y.bought ? "bg-emerald-50" : ""}`}>
                  <td className="py-1.5">{y.year}</td>
                  <td>{y.properties}</td>
                  <td>{fmt.money(y.portfolioValue)}</td>
                  <td>{fmt.money(y.debt)}</td>
                  <td className="font-medium">{fmt.money(y.netWorth)}</td>
                  <td className={y.lvr > 80 ? "text-rose-700" : ""}>{y.lvr}%</td>
                  <td className={y.dti > NZ.dtiInvestor ? "text-rose-700" : ""}>{y.dti}</td>
                  <td className={y.weeklyCashflow < 0 ? "text-rose-700" : "text-emerald-700"}>
                    {fmt.money(y.weeklyCashflow)}
                  </td>
                  <td className="text-xs text-slate-500">
                    {y.bought ? <strong className="text-emerald-700">Bought {y.bought}</strong> : blockText(y)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </Gate>
  );
}

// --------------------------------------------------------------------------- //
// Stress test
// --------------------------------------------------------------------------- //
const VERDICT_STYLE: Record<string, string> = {
  fine: "bg-emerald-100 text-emerald-800",
  tight: "bg-amber-100 text-amber-900",
  trouble: "bg-rose-100 text-rose-900",
};

function StressTab({ f }: { f: Inputs }) {
  const [strategy, setStrategy] = useState<StrategyId>("holdIO");
  const { base, rows } = useMemo(() => stressTest(strategy, f), [strategy, f]);
  const chart = useMemo(() => [{ label: "Today", weeklyCashflow: base.weeklyCashflow }, ...rows], [base, rows]);

  return (
    <Gate
      feature="rateStress"
      title="Stress testing"
      blurb="Rate rises, vacancy and value falls applied to your position — including the two arriving together."
    >
      <div className="space-y-4">
        <section className="card p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">One year out, under pressure</h2>
            <select
              className="input w-auto"
              value={strategy}
              onChange={(e) => setStrategy(e.target.value as StrategyId)}
            >
              <option value="payoff">Live in it, boarders, clear the mortgage</option>
              <option value="recycle">Live in it, boarders, recycle equity</option>
              <option value="holdPI">Rent it out, P&amp;I</option>
              <option value="holdIO">Rent it out, interest-only</option>
            </select>
          </div>
          <ShockChart rows={chart} />
        </section>

        <section className="card overflow-x-auto p-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-400 [&>th]:whitespace-nowrap [&>th]:pr-4">
                <th className="py-2">Scenario</th>
                <th>Cashflow/wk</th>
                <th>Change</th>
                <th>LVR</th>
                <th>Verdict</th>
                <th className="hidden md:table-cell">What it means</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-slate-100 [&>td]:whitespace-nowrap [&>td]:pr-4">
                <td className="py-2 font-medium">Today</td>
                <td>{fmt.money(base.weeklyCashflow)}</td>
                <td>—</td>
                <td>{base.lvr}%</td>
                <td><span className={`badge ${VERDICT_STYLE[base.verdict]}`}>{base.verdict}</span></td>
                <td className="hidden text-xs text-slate-500 md:table-cell">{base.note}</td>
              </tr>
              {rows.map((r) => (
                <tr key={r.label} className="border-t border-slate-100 [&>td]:whitespace-nowrap [&>td]:pr-4">
                  <td className="py-2 font-medium">{r.label}</td>
                  <td className={r.weeklyCashflow < 0 ? "text-rose-700" : "text-emerald-700"}>
                    {fmt.money(r.weeklyCashflow)}
                  </td>
                  <td className="text-slate-500">{fmt.money(r.cashflowDelta)}</td>
                  <td className={r.lvr > 80 ? "text-rose-700" : ""}>{r.lvr}%</td>
                  <td><span className={`badge ${VERDICT_STYLE[r.verdict]}`}>{r.verdict}</span></td>
                  <td className="hidden text-xs text-slate-500 md:table-cell">{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </Gate>
  );
}

// --------------------------------------------------------------------------- //
// Shared bits
// --------------------------------------------------------------------------- //
function Stat({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <div className={`rounded-lg p-3 ${accent ? "bg-emerald-50" : "bg-slate-50"}`}>
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`text-lg font-bold ${accent ? "text-emerald-700" : ""}`}>{value}</p>
      {hint && <p className="text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

function Num({ label, value, onChange, step }: { label: string; value: number; onChange: (v: number) => void; step: number }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <input className="input mt-1" type="number" step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function Range({ label, value, onChange, min, max, step }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step: number }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <input className="mt-1 w-full" type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}
