// Tests for the strategy engine. Run with `npm test` in frontend/.
//
// The engine compounds over 20 years, so an error in one line is invisible in the
// UI and wrong by six figures at the end. These check the properties that must
// hold rather than snapshotting numbers.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  NZ,
  borrowingCapacity,
  compareStrategies,
  compareWeekly,
  equityTimeline,
  holdAnalysis,
  interestOnlyMonthly,
  refinancePoint,
  simulate,
  stressTest,
  weeklyBreakdown,
  type SimInput,
} from "./strategy";

const BASE: SimInput = {
  price: 450_000,
  deposit: 90_000,
  annualRate: 0.055,
  termYears: 30,
  bedrooms: 4,
  roomWeeklyRent: 220,
  wholeHouseWeeklyRent: 600,
  growthPct: 5,
  grossIncome: 110_000,
  years: 20,
};

test("interest-only payment is just the interest", () => {
  assert.equal(interestOnlyMonthly(360_000, 0.06), 1_800);
  assert.equal(interestOnlyMonthly(0, 0.06), 0);
});

test("equity timeline starts at the deposit and amortises", () => {
  const rows = equityTimeline({
    price: 450_000, deposit: 90_000, annualRate: 0.055, termYears: 30, growthPct: 0,
  });
  assert.equal(rows[0].balance, 360_000);
  assert.equal(rows[0].equity, 90_000);
  assert.ok(rows[5].balance < rows[0].balance, "balance should fall on P&I");
  assert.equal(rows[5].value, 450_000, "no growth means no value change");
});

test("interest-only holds the balance flat — all equity comes from growth", () => {
  const io = equityTimeline({
    price: 450_000, deposit: 90_000, annualRate: 0.055, termYears: 30,
    growthPct: 5, interestOnlyYears: 5, years: 5,
  });
  assert.equal(io[5].balance, 360_000, "no principal repaid during interest-only");
  assert.ok(io[5].equity > io[0].equity, "growth still builds equity");
  assert.ok(io[5].lvr < io[0].lvr, "LVR improves purely on value");
});

test("usable equity is capped at the release LVR, not total equity", () => {
  const rows = equityTimeline({
    price: 400_000, deposit: 100_000, annualRate: 0.05, termYears: 30, growthPct: 0, years: 1,
  });
  const r = rows[0];
  assert.equal(r.equity, 100_000);
  // 400k x 0.8 = 320k, less the 300k loan.
  assert.equal(r.usableEquity, 20_000);
  assert.ok(r.usableEquity < r.equity, "banks do not release the last 20%");
});

test("refinance point finds the year equity covers the next deposit", () => {
  const rows = equityTimeline({
    price: 450_000, deposit: 90_000, annualRate: 0.055, termYears: 30, growthPct: 6, years: 20,
  });
  const p = refinancePoint(rows, { nextPrice: 450_000, growthPct: 6 });
  assert.ok(p.year !== null && p.year > 0, "should be reachable with 6% growth");
  assert.ok(p.usableEquity >= p.needed);
  assert.ok(p.loanAfterRelease > 0);
  assert.ok(p.lvrAfterRelease <= 100, "release cannot push past the value");
});

test("refinance never arrives without growth or repayment", () => {
  const flat = equityTimeline({
    price: 450_000, deposit: 45_000, annualRate: 0.055, termYears: 30,
    growthPct: 0, interestOnlyYears: 30, years: 20,
  });
  const p = refinancePoint(flat, { nextPrice: 450_000, growthPct: 0 });
  assert.equal(p.year, null);
});

test("hold on interest-only repays no principal and frees cashflow", () => {
  const shared = {
    value: 450_000, loan: 360_000, annualRate: 0.055, weeklyRent: 600, termYears: 30,
  };
  const io = holdAnalysis({ ...shared, interestOnly: true });
  const pi = holdAnalysis({ ...shared, interestOnly: false });
  assert.equal(io.annualPrincipal, 0);
  assert.ok(pi.annualPrincipal > 0);
  assert.ok(io.preTaxCashflow > pi.preTaxCashflow, "interest-only costs less to hold");
  assert.equal(io.annualInterest, pi.annualInterest, "same debt, same interest");
});

test("a rental loss is ring-fenced, not refunded", () => {
  const h = holdAnalysis({
    value: 700_000, loan: 650_000, annualRate: 0.07, weeklyRent: 550, interestOnly: true,
  });
  assert.ok(h.taxableProfit < 0);
  assert.equal(h.tax, 0, "no tax refund against salary");
  assert.equal(h.ringFencedLoss, -h.taxableProfit);
});

test("break-even rate is the rate at which the tenant stops covering it", () => {
  const input = {
    value: 450_000, loan: 360_000, weeklyRent: 600, interestOnly: true as const,
  };
  const h = holdAnalysis({ ...input, annualRate: 0.055 });
  const atBreakEven = holdAnalysis({ ...input, annualRate: h.breakEvenRatePct / 100 });
  assert.ok(Math.abs(atBreakEven.interestCover - 1) < 0.02, "cover should be ~1.0 at break-even");
  const above = holdAnalysis({ ...input, annualRate: h.breakEvenRatePct / 100 + 0.01 });
  assert.equal(above.coversInterest, false);
});

test("borrowing capacity names the binding constraint", () => {
  const smallDeposit = borrowingCapacity({
    grossIncome: 250_000, deposit: 30_000, annualRate: 0.055,
  });
  assert.equal(smallDeposit.limitedBy, "deposit");
  assert.equal(smallDeposit.maxPurchase, smallDeposit.maxLoan + 30_000);

  const lowIncome = borrowingCapacity({
    grossIncome: 60_000, deposit: 400_000, annualRate: 0.055,
  });
  assert.notEqual(lowIncome.limitedBy, "deposit");
  assert.ok(lowIncome.maxLoan <= 60_000 * NZ.dtiOwnerOccupier);
});

test("investors get a higher DTI cap but a lower LVR", () => {
  const args = { grossIncome: 120_000, deposit: 150_000, annualRate: 0.055 };
  const owner = borrowingCapacity({ ...args });
  const investor = borrowingCapacity({ ...args, isInvestor: true });
  assert.ok(investor.dtiHeadroom > owner.dtiHeadroom);
  assert.ok(investor.depositHeadroom < owner.depositHeadroom);
});

test("existing debt eats DTI headroom", () => {
  const clean = borrowingCapacity({ grossIncome: 120_000, deposit: 200_000, annualRate: 0.055 });
  const geared = borrowingCapacity({
    grossIncome: 120_000, deposit: 200_000, annualRate: 0.055, existingDebt: 500_000,
  });
  assert.ok(geared.dtiHeadroom < clean.dtiHeadroom);
});

test("throwing boarder income at the mortgage clears it early and costs less interest", () => {
  const payoff = simulate("payoff", { ...BASE, roomWeeklyRent: 260 });
  const holdPI = simulate("holdPI", { ...BASE, roomWeeklyRent: 260 });
  assert.ok(payoff.debtFreeYear !== null, "4-bed with boarders should clear inside 20 years");
  assert.ok(payoff.debtFreeYear! < 20, `cleared in year ${payoff.debtFreeYear}`);
  assert.ok(payoff.totalInterest < holdPI.totalInterest);
  assert.equal(payoff.final.properties, 1);
});

test("rent that only just covers the costs barely accelerates anything", () => {
  // $220/wk x 3 rooms against a $360k mortgage plus rates, insurance and
  // maintenance is close to break-even — the payoff is slow, and the app should
  // not pretend otherwise.
  const payoff = simulate("payoff", BASE);
  const holdPI = simulate("holdPI", BASE);
  assert.equal(payoff.final.debt, 0, "it does clear, but only just inside the horizon");
  assert.ok(holdPI.final.debt > 0);
});

test("interest-only leaves the debt where it started", () => {
  const io = simulate("holdIO", { ...BASE, years: 5, interestOnlyYears: 5 });
  assert.ok(Math.abs(io.final.debt - (BASE.price - BASE.deposit)) < 1);
  const pi = simulate("holdPI", { ...BASE, years: 5 });
  assert.ok(pi.final.debt < io.final.debt, "P&I actually pays it down");
  assert.ok(io.final.weeklyCashflow > pi.final.weeklyCashflow, "IO buys cashflow");
});

test("recycling equity buys more property and carries more debt", () => {
  const recycle = simulate("recycle", { ...BASE, grossIncome: 180_000, growthPct: 6 });
  const payoff = simulate("payoff", { ...BASE, grossIncome: 180_000, growthPct: 6 });
  assert.ok(recycle.acquisitions.length >= 1, "should buy at least once in 20 years");
  assert.ok(recycle.final.properties > payoff.final.properties);
  assert.ok(recycle.final.debt > payoff.final.debt, "leverage is the trade");
  assert.ok(recycle.final.portfolioValue > payoff.final.portfolioValue);
});

test("a low income blocks the second purchase on DTI or servicing, not equity", () => {
  const poor = simulate("recycle", { ...BASE, grossIncome: 55_000, growthPct: 8 });
  const blockers = new Set(poor.years.map((y) => y.blockedBy).filter(Boolean));
  assert.ok(blockers.size > 0, "something should block it");
  assert.ok(
    blockers.has("DTI") || blockers.has("servicing"),
    `income should bind, got ${[...blockers].join(", ")}`,
  );
});

test("acquisitions are funded by debt, so LVR rises when you buy", () => {
  const sim = simulate("recycle", { ...BASE, grossIncome: 200_000, growthPct: 6 });
  const first = sim.acquisitions[0];
  assert.ok(first, "expected an acquisition");
  const before = sim.years[first.year - 1];
  const after = sim.years[first.year];
  assert.ok(after.lvr > before.lvr, "buying with released equity raises portfolio LVR");
  assert.ok(after.debt > before.debt + first.price * NZ.investorMaxLvr * 0.9);
});

test("strategies compare like for like and rank by net worth", () => {
  const rows = compareStrategies(BASE);
  assert.equal(rows.length, 4);
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i - 1].netWorth >= rows[i].netWorth, "sorted descending");
  }
  assert.ok(rows.every((r) => r.tradeoff.length > 0), "every option states its cost");
});

test("stress tests move the right way and flag trouble", () => {
  const { base, rows } = stressTest("holdIO", BASE);
  const rateShock = rows.find((r) => r.label === "Rates +3%")!;
  assert.ok(rateShock.weeklyCashflow < base.weeklyCashflow);
  assert.ok(rateShock.cashflowDelta < 0);

  const crash = rows.find((r) => r.label === "Values −15%")!;
  assert.ok(crash.lvr > base.lvr, "a value fall raises LVR");

  const worst = rows[rows.length - 1];
  assert.ok(worst.verdict !== "fine", "the combined shock should not read as fine");
});

test("the weekly breakdown adds up to the net, and matches the simulation", () => {
  for (const b of compareWeekly(BASE)) {
    const out = b.interestWeekly + b.principalWeekly + b.runningWeekly + b.taxWeekly;
    // Five independently rounded weekly figures, so allow the rounding drift.
    assert.ok(
      Math.abs(b.incomeWeekly - out - b.netWeekly) <= 3,
      `${b.strategy}: ${b.incomeWeekly} - ${out} != ${b.netWeekly}`,
    );
    // Year one of the full simulation is the same money, to rounding.
    const sim = simulate(b.strategy, { ...BASE, years: 1 });
    assert.ok(
      Math.abs(sim.final.weeklyCashflow - b.netWeekly) < 2,
      `${b.strategy}: breakdown ${b.netWeekly} vs simulation ${sim.final.weeklyCashflow}`,
    );
  }
});

test("interest-only shows no principal, and P&I shows some", () => {
  const io = weeklyBreakdown("holdIO", BASE);
  const pi = weeklyBreakdown("holdPI", BASE);
  assert.equal(io.principalWeekly, 0);
  assert.ok(pi.principalWeekly > 0);
  // P&I pays slightly less interest even in year one, because the balance is
  // already falling. Interest-only never gets that discount.
  assert.ok(io.interestWeekly > pi.interestWeekly);
  assert.ok(io.netWeekly > pi.netWeekly);
});

test("boarder income under the threshold is untaxed; a rental profit is not", () => {
  const boarders = weeklyBreakdown("payoff", { ...BASE, roomWeeklyRent: 200 });
  assert.equal(boarders.taxWeekly, 0, "under $245/wk per boarder is tax-free");

  const rental = weeklyBreakdown("holdIO", {
    ...BASE, deposit: 400_000, wholeHouseWeeklyRent: 700,
  });
  assert.ok(rental.taxWeekly > 0, "a barely-geared rental turns a taxable profit");
});

test("every strategy explains itself without jargon", () => {
  for (const b of compareWeekly(BASE)) {
    assert.ok(b.plain.length > 20 && b.incomeLabel.length > 0);
    assert.ok(!/LVR|DTI|amorti|ring-fenc/i.test(b.plain), `${b.strategy} leaks jargon`);
  }
});

test("a highly geared position is called out as trouble", () => {
  const thin = { ...BASE, deposit: 25_000, wholeHouseWeeklyRent: 450 };
  const { rows } = stressTest("holdIO", thin);
  assert.ok(
    rows.some((r) => r.verdict === "trouble"),
    "5% deposit on interest-only should break under stress",
  );
});
