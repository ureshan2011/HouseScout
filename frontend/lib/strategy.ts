// Strategy engine — the "what happens after I buy" half of the app.
//
// finance.ts answers "can I afford this one house?". This answers the questions
// that follow: when does equity let me buy again, what does holding on
// interest-only actually cost, and what stops me — deposit, DTI, or cashflow?
//
// Pure functions, no I/O. Every rule below is a named constant so it can be
// checked against the source rather than trusted.

import { MONTHS_PER_YEAR, WEEKS_PER_YEAR, BOARDER_TAX_FREE_WEEKLY, MAX_BOARDERS } from "./finance";

// --------------------------------------------------------------------------- //
// NZ lending and tax settings (as at 2026)
// --------------------------------------------------------------------------- //
export const NZ = {
  /** RBNZ LVR speed limits — the practical deposit floor for most borrowers. */
  ownerOccupierMaxLvr: 0.8,
  investorMaxLvr: 0.65,
  newBuildInvestorMaxLvr: 0.7,
  /** How far banks will normally let you top up an existing loan to release cash. */
  releaseLvr: 0.8,
  /** RBNZ debt-to-income caps (20% of a bank's new lending may exceed them). */
  dtiOwnerOccupier: 6,
  dtiInvestor: 7,
  /** Sale within this many years of purchase is taxed on the gain. */
  brightLineYears: 2,
  /** Interest on residential rentals is fully deductible again from 1 Apr 2025. */
  interestDeductible: 1.0,
  /** Banks assess servicing above the offered rate. */
  servicingBuffer: 0.02,
  /** Share of rent a bank counts as income. */
  rentShading: 0.75,
} as const;

/** Typical one-off costs to complete a purchase: legal, LIM, builder's report, valuation. */
export const DEFAULT_PURCHASE_COSTS = 4_500;

const DEFAULTS = {
  vacancyWeeks: 3,
  ratesAnnual: 3_200,
  insuranceAnnual: 2_200,
  maintenancePct: 0.01,
  managementPct: 0.0,
  marginalTaxRate: 0.33,
  livingCostsMonthly: 2_400,
};

function round(n: number, dp = 0): number {
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
}

function monthlyPI(principal: number, annualRate: number, termYears: number): number {
  if (principal <= 0 || termYears <= 0) return 0;
  const n = termYears * MONTHS_PER_YEAR;
  const r = annualRate / MONTHS_PER_YEAR;
  if (r === 0) return principal / n;
  return (principal * r * (1 + r) ** n) / ((1 + r) ** n - 1);
}

export function interestOnlyMonthly(loan: number, annualRate: number): number {
  return Math.max(0, loan) * annualRate / MONTHS_PER_YEAR;
}

// --------------------------------------------------------------------------- //
// Equity timeline — when can I borrow against this house again?
// --------------------------------------------------------------------------- //
export type EquityYear = {
  year: number;
  value: number;
  balance: number;
  /** Value minus debt: what you'd walk away with, before selling costs. */
  equity: number;
  /** What a bank will actually release: value x releaseLvr, minus the loan. */
  usableEquity: number;
  lvr: number;
};

export type EquityInput = {
  price: number;
  deposit: number;
  annualRate: number;
  termYears: number;
  /** Annual capital growth, as a percentage. */
  growthPct: number;
  extraMonthly?: number;
  /** Years on interest-only before P&I starts. Balance stays flat through these. */
  interestOnlyYears?: number;
  years?: number;
  releaseLvr?: number;
};

/** Year-by-year value, debt and releasable equity for a single property. */
export function equityTimeline(input: EquityInput): EquityYear[] {
  const horizon = input.years ?? 15;
  const releaseLvr = input.releaseLvr ?? NZ.releaseLvr;
  const ioMonths = (input.interestOnlyYears ?? 0) * MONTHS_PER_YEAR;
  const g = input.growthPct / 100;
  const r = input.annualRate / MONTHS_PER_YEAR;

  let balance = Math.max(input.price - input.deposit, 0);
  let value = input.price;
  // After an interest-only period the same debt has to clear in the years that remain.
  let pmt = monthlyPI(balance, input.annualRate, input.termYears - (input.interestOnlyYears ?? 0));

  const rows: EquityYear[] = [];
  const snapshot = (year: number) =>
    rows.push({
      year,
      value: round(value),
      balance: round(balance),
      equity: round(value - balance),
      usableEquity: round(Math.max(0, value * releaseLvr - balance)),
      lvr: value > 0 ? round((balance / value) * 100, 1) : 0,
    });

  snapshot(0);
  for (let m = 1; m <= horizon * MONTHS_PER_YEAR; m++) {
    const interest = balance * r;
    if (m <= ioMonths) {
      // Interest-only: the debt does not move, so every dollar of equity is growth.
    } else {
      const principal = Math.min(balance, Math.max(0, pmt + (input.extraMonthly ?? 0) - interest));
      balance -= principal;
    }
    if (m % MONTHS_PER_YEAR === 0) {
      value *= 1 + g;
      snapshot(m / MONTHS_PER_YEAR);
    }
  }
  return rows;
}

export type RefinancePoint = {
  /** Years until the equity release covers the next deposit. Null if never, in horizon. */
  year: number | null;
  usableEquity: number;
  /** Deposit + costs needed at that point, with the next property priced at growth. */
  needed: number;
  nextPrice: number;
  /** Debt after releasing: the release is new borrowing, not free money. */
  loanAfterRelease: number;
  lvrAfterRelease: number;
};

/**
 * When the equity in this property funds the deposit on the next one.
 *
 * The release is a top-up of the existing mortgage, so it lands as debt on this
 * property and its repayments come out of the same cashflow — which is why
 * `loanAfterRelease` is reported alongside the answer.
 */
export function refinancePoint(
  timeline: EquityYear[],
  opts: {
    nextPrice: number;
    growthPct: number;
    depositPct?: number;
    purchaseCosts?: number;
  },
): RefinancePoint {
  const depositPct = opts.depositPct ?? 1 - NZ.investorMaxLvr;
  const costs = opts.purchaseCosts ?? DEFAULT_PURCHASE_COSTS;
  const g = opts.growthPct / 100;

  let last: RefinancePoint = {
    year: null,
    usableEquity: 0,
    needed: 0,
    nextPrice: opts.nextPrice,
    loanAfterRelease: 0,
    lvrAfterRelease: 0,
  };

  for (const row of timeline) {
    const nextPrice = opts.nextPrice * (1 + g) ** row.year;
    const needed = nextPrice * depositPct + costs;
    const release = Math.min(row.usableEquity, needed);
    const loanAfter = row.balance + release;
    last = {
      year: row.usableEquity >= needed ? row.year : null,
      usableEquity: round(row.usableEquity),
      needed: round(needed),
      nextPrice: round(nextPrice),
      loanAfterRelease: round(loanAfter),
      lvrAfterRelease: row.value > 0 ? round((loanAfter / row.value) * 100, 1) : 0,
    };
    if (last.year !== null) return last;
  }
  return { ...last, year: null };
}

// --------------------------------------------------------------------------- //
// Holding a rental — does the tenant actually cover it?
// --------------------------------------------------------------------------- //
export type HoldInput = {
  value: number;
  loan: number;
  annualRate: number;
  weeklyRent: number;
  interestOnly: boolean;
  termYears?: number;
  vacancyWeeks?: number;
  ratesAnnual?: number;
  insuranceAnnual?: number;
  maintenancePct?: number;
  managementPct?: number;
  marginalTaxRate?: number;
};

export type Hold = {
  annualRent: number;
  annualInterest: number;
  annualPrincipal: number;
  annualOpex: number;
  /** Rent minus every cash cost, before tax. */
  preTaxCashflow: number;
  /** Rent minus deductible costs. Negative losses are ring-fenced, not refunded. */
  taxableProfit: number;
  tax: number;
  afterTaxCashflow: number;
  weeklyAfterTax: number;
  /** Rent net of running costs, divided by interest. Above 1.0 means the tenant pays it. */
  interestCover: number;
  coversInterest: boolean;
  /** The rate at which rent stops covering interest and running costs. */
  breakEvenRatePct: number;
  /** The rent needed to break even at today's rate. */
  breakEvenRentWeekly: number;
  ringFencedLoss: number;
};

/**
 * A year of holding, on interest-only or P&I.
 *
 * Interest-only is the lever behind "let the tenant hold it": payments drop to
 * interest, so a property that bleeds on P&I can sit at break-even. It buys
 * cashflow, not equity — the debt is exactly the same in five years.
 */
export function holdAnalysis(input: HoldInput): Hold {
  const vacancy = input.vacancyWeeks ?? DEFAULTS.vacancyWeeks;
  const rates = input.ratesAnnual ?? DEFAULTS.ratesAnnual;
  const insurance = input.insuranceAnnual ?? DEFAULTS.insuranceAnnual;
  const maintenance = input.value * (input.maintenancePct ?? DEFAULTS.maintenancePct);
  const rentWeeks = Math.max(0, WEEKS_PER_YEAR - vacancy);
  const annualRent = input.weeklyRent * rentWeeks;
  const management = annualRent * (input.managementPct ?? DEFAULTS.managementPct);
  const taxRate = input.marginalTaxRate ?? DEFAULTS.marginalTaxRate;

  const annualOpex = rates + insurance + maintenance + management;
  const annualInterest = input.loan * input.annualRate;

  const pmt = monthlyPI(input.loan, input.annualRate, input.termYears ?? 30) * MONTHS_PER_YEAR;
  const annualPrincipal = input.interestOnly ? 0 : Math.max(0, pmt - annualInterest);

  const preTax = annualRent - annualOpex - annualInterest - annualPrincipal;
  // Principal is not an expense; interest is (100% deductible from April 2025).
  const taxableProfit = annualRent - annualOpex - annualInterest * NZ.interestDeductible;
  // A loss cannot offset salary — it is ring-fenced and carried forward.
  const tax = taxableProfit > 0 ? taxableProfit * taxRate : 0;
  const ringFencedLoss = taxableProfit < 0 ? -taxableProfit : 0;
  const afterTax = preTax - tax;

  const netOfOpex = annualRent - annualOpex;
  const breakEvenRate = input.loan > 0 ? netOfOpex / input.loan : 0;

  return {
    annualRent: round(annualRent),
    annualInterest: round(annualInterest),
    annualPrincipal: round(annualPrincipal),
    annualOpex: round(annualOpex),
    preTaxCashflow: round(preTax),
    taxableProfit: round(taxableProfit),
    tax: round(tax),
    afterTaxCashflow: round(afterTax),
    weeklyAfterTax: round(afterTax / WEEKS_PER_YEAR),
    interestCover: annualInterest > 0 ? round(netOfOpex / annualInterest, 2) : Infinity,
    coversInterest: netOfOpex >= annualInterest,
    breakEvenRatePct: round(Math.max(0, breakEvenRate) * 100, 2),
    breakEvenRentWeekly: round((annualOpex + annualInterest) / Math.max(1, rentWeeks)),
    ringFencedLoss: round(ringFencedLoss),
  };
}

// --------------------------------------------------------------------------- //
// Borrowing capacity — the ceiling most beginners find out about too late
// --------------------------------------------------------------------------- //
export type CapacityInput = {
  grossIncome: number;
  deposit: number;
  existingDebt?: number;
  /** Rent already coming in, annual and gross. Banks discount it. */
  existingRentAnnual?: number;
  annualRate: number;
  termYears?: number;
  isInvestor?: boolean;
  livingCostsMonthly?: number;
  maxLvr?: number;
};

export type Capacity = {
  /** Total borrowing the DTI cap allows, less what you already owe. */
  dtiHeadroom: number;
  dtiCap: number;
  /** Borrowing the servicing test allows at the bank's stressed rate. */
  servicingHeadroom: number;
  /** Borrowing the deposit allows under LVR rules. */
  depositHeadroom: number;
  /** The binding constraint — the one that actually caps your purchase. */
  limitedBy: "deposit" | "DTI" | "servicing";
  maxLoan: number;
  maxPurchase: number;
  testRatePct: number;
};

/**
 * What a bank will lend, under all three tests at once.
 *
 * Deposit is the one buyers track; DTI and servicing are usually what bind, and
 * they bind harder with every property. Naming the binding constraint is the
 * point of this function.
 */
export function borrowingCapacity(input: CapacityInput): Capacity {
  const term = input.termYears ?? 30;
  const maxLvr = input.maxLvr ?? (input.isInvestor ? NZ.investorMaxLvr : NZ.ownerOccupierMaxLvr);
  const dtiCap = input.isInvestor ? NZ.dtiInvestor : NZ.dtiOwnerOccupier;
  const existingDebt = input.existingDebt ?? 0;
  const shadedRent = (input.existingRentAnnual ?? 0) * NZ.rentShading;

  const assessableIncome = input.grossIncome + shadedRent;
  const dtiHeadroom = Math.max(0, assessableIncome * dtiCap - existingDebt);

  // Servicing: what's left after tax and living costs, capitalised at the test rate.
  const testRate = input.annualRate + NZ.servicingBuffer;
  const netMonthlyIncome = (assessableIncome * (1 - DEFAULTS.marginalTaxRate)) / MONTHS_PER_YEAR;
  const living = input.livingCostsMonthly ?? DEFAULTS.livingCostsMonthly;
  const existingPmt = monthlyPI(existingDebt, testRate, term);
  const surplus = Math.max(0, netMonthlyIncome - living - existingPmt);
  // Invert the P&I formula: the loan whose stressed payment equals the surplus.
  const r = testRate / MONTHS_PER_YEAR;
  const n = term * MONTHS_PER_YEAR;
  const servicingHeadroom = r > 0 ? (surplus * ((1 + r) ** n - 1)) / (r * (1 + r) ** n) : surplus * n;

  const depositHeadroom = (input.deposit * maxLvr) / (1 - maxLvr);

  const maxLoan = Math.min(dtiHeadroom, servicingHeadroom, depositHeadroom);
  const limitedBy =
    maxLoan === depositHeadroom ? "deposit" : maxLoan === dtiHeadroom ? "DTI" : "servicing";

  return {
    dtiHeadroom: round(dtiHeadroom),
    dtiCap,
    servicingHeadroom: round(servicingHeadroom),
    depositHeadroom: round(depositHeadroom),
    limitedBy,
    maxLoan: round(maxLoan),
    maxPurchase: round(maxLoan + input.deposit),
    testRatePct: round(testRate * 100, 2),
  };
}

// --------------------------------------------------------------------------- //
// Multi-property simulation
// --------------------------------------------------------------------------- //
export type StrategyId =
  | "payoff"        // live in it, boarders, throw everything at the mortgage
  | "recycle"       // live in it, boarders, refinance to buy rentals
  | "holdPI"        // buy and hold on P&I, whole-house tenancy
  | "holdIO";       // buy and hold on interest-only

export type SimInput = {
  price: number;
  deposit: number;
  annualRate: number;
  termYears: number;
  bedrooms: number;
  /** Per-room weekly rent when you live there; whole-house weekly rent otherwise. */
  roomWeeklyRent: number;
  wholeHouseWeeklyRent: number;
  growthPct: number;
  rentGrowthPct?: number;
  grossIncome: number;
  years?: number;
  maxProperties?: number;
  /** Today's price of the next property you'd buy. Defaults to the first one. */
  nextPrice?: number;
  purchaseCosts?: number;
  marginalTaxRate?: number;
  vacancyWeeks?: number;
  ratesAnnual?: number;
  insuranceAnnual?: number;
  maintenancePct?: number;
  managementPct?: number;
  livingCostsMonthly?: number;
  /** Interest-only years applied to investment properties. */
  interestOnlyYears?: number;
};

type Holding = {
  label: string;
  value: number;
  loan: number;
  weeklyRent: number;
  ownerOccupied: boolean;
  ioMonthsLeft: number;
  pmt: number;
  termMonthsLeft: number;
  purchaseYear: number;
};

export type SimYear = {
  year: number;
  properties: number;
  portfolioValue: number;
  debt: number;
  equity: number;
  usableEquity: number;
  cash: number;
  /** Equity + cash: the number that actually compounds. */
  netWorth: number;
  lvr: number;
  dti: number;
  annualCashflow: number;
  weeklyCashflow: number;
  interestPaid: number;
  bought: string | null;
  /** Why no purchase happened this year, when one was wanted. */
  blockedBy: "equity" | "DTI" | "servicing" | null;
  /** How far short that test fell, in dollars. */
  blockedShortfall: number;
  /** What the next purchase would have cost, at that year's prices. */
  nextPrice: number;
};

export type Simulation = {
  strategy: StrategyId;
  label: string;
  years: SimYear[];
  acquisitions: { year: number; label: string; price: number; deposit: number }[];
  /** Year the owner-occupied mortgage clears. Null if it doesn't inside the horizon. */
  debtFreeYear: number | null;
  final: SimYear;
  totalInterest: number;
};

const STRATEGY_LABEL: Record<StrategyId, string> = {
  payoff: "Live in it, boarders, clear the mortgage",
  recycle: "Live in it, boarders, recycle equity",
  holdPI: "Rent it out, principal & interest",
  holdIO: "Rent it out, interest-only",
};

/** Rentable rooms and the tax-free share, per the IRD standard-cost method. */
function boarderWeekly(bedrooms: number, roomRent: number): { gross: number; taxable: number } {
  const rooms = Math.max(0, Math.min((bedrooms || 0) - 1, MAX_BOARDERS));
  const gross = rooms * roomRent;
  const taxable = Math.max(0, gross - Math.min(roomRent, BOARDER_TAX_FREE_WEEKLY) * rooms);
  return { gross, taxable };
}

/**
 * Run a strategy forward, month by month, and report what it costs and builds.
 *
 * The four strategies differ only in configuration — same maths, same costs, same
 * tax — so the comparison between them is like-for-like rather than four separate
 * models that happen to be printed next to each other.
 */
export function simulate(strategy: StrategyId, input: SimInput): Simulation {
  const horizon = input.years ?? 20;
  const growth = input.growthPct / 100;
  const rentGrowth = (input.rentGrowthPct ?? Math.min(input.growthPct, 3.5)) / 100;
  const taxRate = input.marginalTaxRate ?? DEFAULTS.marginalTaxRate;
  const costs = input.purchaseCosts ?? DEFAULT_PURCHASE_COSTS;
  const vacancy = input.vacancyWeeks ?? DEFAULTS.vacancyWeeks;
  const maxProps = input.maxProperties ?? 5;
  const ioYears = input.interestOnlyYears ?? 5;
  const r = input.annualRate / MONTHS_PER_YEAR;

  const ownerOccupied = strategy === "payoff" || strategy === "recycle";
  const recycles = strategy === "recycle";
  const firstIsIO = strategy === "holdIO";

  const first: Holding = {
    label: "Home",
    value: input.price,
    loan: Math.max(0, input.price - input.deposit),
    weeklyRent: ownerOccupied ? input.roomWeeklyRent : input.wholeHouseWeeklyRent,
    ownerOccupied,
    ioMonthsLeft: firstIsIO ? ioYears * MONTHS_PER_YEAR : 0,
    pmt: 0,
    termMonthsLeft: input.termYears * MONTHS_PER_YEAR,
    purchaseYear: 0,
  };
  first.pmt = monthlyPI(first.loan, input.annualRate, input.termYears);

  const props: Holding[] = [first];
  const acquisitions: Simulation["acquisitions"] = [];
  const years: SimYear[] = [];
  let cash = 0;
  let carriedLoss = 0;
  let totalInterest = 0;
  let debtFreeYear: number | null = null;

  const opexAnnual = (p: Holding) =>
    (input.ratesAnnual ?? DEFAULTS.ratesAnnual) +
    (input.insuranceAnnual ?? DEFAULTS.insuranceAnnual) +
    p.value * (input.maintenancePct ?? DEFAULTS.maintenancePct) +
    (p.ownerOccupied ? 0 : p.weeklyRent * (WEEKS_PER_YEAR - vacancy) * (input.managementPct ?? DEFAULTS.managementPct));

  const snapshot = (year: number, extra: Partial<SimYear>): SimYear => {
    const value = props.reduce((s, p) => s + p.value, 0);
    const debt = props.reduce((s, p) => s + p.loan, 0);
    const usable = props.reduce((s, p) => s + Math.max(0, p.value * NZ.releaseLvr - p.loan), 0);
    const rentAnnual = props
      .filter((p) => !p.ownerOccupied)
      .reduce((s, p) => s + p.weeklyRent * (WEEKS_PER_YEAR - vacancy), 0);
    return {
      year,
      properties: props.length,
      portfolioValue: round(value),
      debt: round(debt),
      equity: round(value - debt),
      usableEquity: round(usable),
      cash: round(cash),
      netWorth: round(value - debt + cash),
      lvr: value > 0 ? round((debt / value) * 100, 1) : 0,
      dti: round(debt / Math.max(1, input.grossIncome + rentAnnual * NZ.rentShading), 1),
      annualCashflow: 0,
      weeklyCashflow: 0,
      interestPaid: 0,
      bought: null,
      blockedBy: null,
      blockedShortfall: 0,
      nextPrice: 0,
      ...extra,
    };
  };

  years.push(snapshot(0, {}));

  for (let y = 1; y <= horizon; y++) {
    let yearInterest = 0;
    let yearPrincipal = 0;
    let yearRent = 0;
    let yearBoarder = 0;
    let yearBoarderTaxable = 0;
    let yearOpex = 0;

    for (const p of props) yearOpex += opexAnnual(p);

    for (let m = 1; m <= MONTHS_PER_YEAR; m++) {
      for (const p of props) {
        const interest = p.loan * r;
        yearInterest += interest;
        if (p.loan <= 0) continue;
        if (p.ioMonthsLeft > 0) {
          p.ioMonthsLeft -= 1;
          if (p.ioMonthsLeft === 0) {
            // Interest-only ends: the same debt now has fewer years to clear, so
            // the payment steps up. This is the shock that catches people out.
            p.pmt = monthlyPI(p.loan, input.annualRate, Math.max(1, p.termMonthsLeft / MONTHS_PER_YEAR));
          }
        } else {
          const principal = Math.min(p.loan, Math.max(0, p.pmt - interest));
          p.loan -= principal;
          yearPrincipal += principal;
        }
        p.termMonthsLeft = Math.max(0, p.termMonthsLeft - 1);
      }

      for (const p of props) {
        if (p.ownerOccupied) {
          const b = boarderWeekly(input.bedrooms, p.weeklyRent);
          yearBoarder += (b.gross * WEEKS_PER_YEAR) / MONTHS_PER_YEAR;
          yearBoarderTaxable += (b.taxable * WEEKS_PER_YEAR) / MONTHS_PER_YEAR;
        } else {
          yearRent += (p.weeklyRent * (WEEKS_PER_YEAR - vacancy)) / MONTHS_PER_YEAR;
        }
      }
    }

    totalInterest += yearInterest;

    // Tax. Rental interest is deductible; a net rental loss is ring-fenced and
    // carried forward, so it never reduces tax on salary.
    const rentalInterest = props
      .filter((p) => !p.ownerOccupied)
      .reduce((s, p) => s + p.loan * input.annualRate, 0);
    const rentalOpex = props.filter((p) => !p.ownerOccupied).reduce((s, p) => s + opexAnnual(p), 0);
    const rentalProfit = yearRent - rentalOpex - rentalInterest * NZ.interestDeductible - carriedLoss;
    let tax = 0;
    if (rentalProfit > 0) {
      tax = rentalProfit * taxRate;
      carriedLoss = 0;
    } else {
      carriedLoss = -rentalProfit;
    }
    tax += yearBoarderTaxable * taxRate;

    const cashflow = yearRent + yearBoarder - yearOpex - yearInterest - yearPrincipal - tax;
    cash += cashflow;

    if (debtFreeYear === null && props[0].loan <= 0.5) debtFreeYear = y;

    // Grow values and rents into next year.
    for (const p of props) {
      p.value *= 1 + growth;
      p.weeklyRent *= 1 + rentGrowth;
    }

    // Surplus goes to the mortgage under "payoff"; otherwise it stays as cash and
    // becomes deposit ammunition.
    if (strategy === "payoff" && cash > 0) {
      const target = props[0];
      const applied = Math.min(cash, target.loan);
      target.loan -= applied;
      cash -= applied;
      yearPrincipal += applied;
    }

    let bought: string | null = null;
    let blockedBy: SimYear["blockedBy"] = null;
    let blockedShortfall = 0;
    let nextPriceThisYear = 0;

    if (recycles && props.length < maxProps) {
      const nextPrice = (input.nextPrice ?? input.price) * (1 + growth) ** y;
      nextPriceThisYear = nextPrice;
      const depositNeeded = nextPrice * (1 - NZ.investorMaxLvr) + costs;
      const usable = props.reduce((s, p) => s + Math.max(0, p.value * NZ.releaseLvr - p.loan), 0);
      const available = usable + Math.max(0, cash);

      const rentAnnual = props
        .filter((p) => !p.ownerOccupied)
        .reduce((s, p) => s + p.weeklyRent * (WEEKS_PER_YEAR - vacancy), 0);
      const debtNow = props.reduce((s, p) => s + p.loan, 0);
      const cap = borrowingCapacity({
        grossIncome: input.grossIncome,
        deposit: available,
        existingDebt: debtNow,
        existingRentAnnual: rentAnnual,
        annualRate: input.annualRate,
        termYears: input.termYears,
        isInvestor: true,
        livingCostsMonthly: input.livingCostsMonthly,
      });

      // The whole purchase is debt-funded — the deposit comes from a top-up — so
      // both income tests are measured against the full price, not the deposit.
      if (available < depositNeeded) {
        blockedBy = "equity";
        blockedShortfall = round(depositNeeded - available);
      } else if (cap.dtiHeadroom < nextPrice) {
        blockedBy = "DTI";
        blockedShortfall = round(nextPrice - cap.dtiHeadroom);
      } else if (cap.servicingHeadroom < nextPrice) {
        blockedBy = "servicing";
        blockedShortfall = round(nextPrice - cap.servicingHeadroom);
      } else {
        // Release equity as new debt on the existing portfolio, then borrow the
        // rest against the new property. Nothing here is free money.
        let toRaise = depositNeeded - Math.max(0, Math.min(cash, depositNeeded));
        cash -= Math.min(Math.max(0, cash), depositNeeded);
        for (const p of props) {
          if (toRaise <= 0) break;
          const room = Math.max(0, p.value * NZ.releaseLvr - p.loan);
          const take = Math.min(room, toRaise);
          p.loan += take;
          p.pmt = monthlyPI(p.loan, input.annualRate, Math.max(1, p.termMonthsLeft / MONTHS_PER_YEAR));
          toRaise -= take;
        }
        const label = `Rental ${props.length}`;
        const newLoan = nextPrice * NZ.investorMaxLvr;
        const rent = input.wholeHouseWeeklyRent * (1 + rentGrowth) ** y;
        props.push({
          label,
          value: nextPrice,
          loan: newLoan,
          weeklyRent: rent,
          ownerOccupied: false,
          ioMonthsLeft: ioYears * MONTHS_PER_YEAR,
          pmt: monthlyPI(newLoan, input.annualRate, input.termYears),
          termMonthsLeft: input.termYears * MONTHS_PER_YEAR,
          purchaseYear: y,
        });
        acquisitions.push({ year: y, label, price: round(nextPrice), deposit: round(depositNeeded) });
        bought = label;
      }
    }

    years.push(
      snapshot(y, {
        annualCashflow: round(cashflow),
        weeklyCashflow: round(cashflow / WEEKS_PER_YEAR),
        interestPaid: round(yearInterest),
        bought,
        blockedBy,
        blockedShortfall,
        nextPrice: round(nextPriceThisYear),
      }),
    );
  }

  return {
    strategy,
    label: STRATEGY_LABEL[strategy],
    years,
    acquisitions,
    debtFreeYear,
    final: years[years.length - 1],
    totalInterest: round(totalInterest),
  };
}

// --------------------------------------------------------------------------- //
// One week of money — the beginner-facing view of a strategy
// --------------------------------------------------------------------------- //
export type WeeklyBreakdown = {
  strategy: StrategyId;
  label: string;
  /** What you are actually doing, in a sentence with no jargon in it. */
  plain: string;
  incomeLabel: string;
  incomeWeekly: number;
  interestWeekly: number;
  principalWeekly: number;
  /** Rates, insurance, upkeep and management. */
  runningWeekly: number;
  taxWeekly: number;
  /** Income minus everything. Negative means it comes out of your wages. */
  netWeekly: number;
};

const PLAIN: Record<StrategyId, string> = {
  payoff: "You live here and rent the spare rooms. Every spare dollar goes onto the mortgage.",
  recycle: "You live here and rent the spare rooms, but keep the cash to put a deposit on a rental.",
  holdPI: "You rent the whole house to a tenant and pay the mortgage down normally.",
  holdIO: "You rent the whole house to a tenant and pay only the interest, so the loan stays put.",
};

const INCOME_LABEL: Record<StrategyId, string> = {
  payoff: "Boarders pay you",
  recycle: "Boarders pay you",
  holdPI: "Tenant pays you",
  holdIO: "Tenant pays you",
};

/**
 * The first year of a strategy, reduced to one week of money.
 *
 * Interest and principal come from running twelve real months rather than
 * `loan x rate`, so the split is the one the bank would actually charge.
 */
export function weeklyBreakdown(strategy: StrategyId, input: SimInput): WeeklyBreakdown {
  const ownerOccupied = strategy === "payoff" || strategy === "recycle";
  const interestOnly = strategy === "holdIO";
  const taxRate = input.marginalTaxRate ?? DEFAULTS.marginalTaxRate;
  const vacancy = input.vacancyWeeks ?? DEFAULTS.vacancyWeeks;
  const r = input.annualRate / MONTHS_PER_YEAR;

  const loan = Math.max(0, input.price - input.deposit);
  const pmt = monthlyPI(loan, input.annualRate, input.termYears);
  let balance = loan;
  let interest = 0;
  let principal = 0;
  for (let m = 0; m < MONTHS_PER_YEAR; m++) {
    const i = balance * r;
    interest += i;
    if (!interestOnly) {
      const p = Math.min(balance, Math.max(0, pmt - i));
      balance -= p;
      principal += p;
    }
  }

  const boarders = boarderWeekly(input.bedrooms, input.roomWeeklyRent);
  const rentWeeks = Math.max(0, WEEKS_PER_YEAR - vacancy);
  const annualIncome = ownerOccupied
    ? boarders.gross * WEEKS_PER_YEAR
    : input.wholeHouseWeeklyRent * rentWeeks;

  const management = ownerOccupied
    ? 0
    : annualIncome * (input.managementPct ?? DEFAULTS.managementPct);
  const running =
    (input.ratesAnnual ?? DEFAULTS.ratesAnnual) +
    (input.insuranceAnnual ?? DEFAULTS.insuranceAnnual) +
    input.price * (input.maintenancePct ?? DEFAULTS.maintenancePct) +
    management;

  // Boarder income is tax-free to the IRD threshold; rental profit is taxed, and
  // a rental loss is ring-fenced rather than refunded.
  const tax = ownerOccupied
    ? boarders.taxable * WEEKS_PER_YEAR * taxRate
    : Math.max(0, annualIncome - running - interest * NZ.interestDeductible) * taxRate;

  const wk = (annual: number) => round(annual / WEEKS_PER_YEAR);
  const net = annualIncome - running - interest - principal - tax;

  return {
    strategy,
    label: STRATEGY_LABEL[strategy],
    plain: PLAIN[strategy],
    incomeLabel: INCOME_LABEL[strategy],
    incomeWeekly: wk(annualIncome),
    interestWeekly: wk(interest),
    principalWeekly: wk(principal),
    runningWeekly: wk(running),
    taxWeekly: wk(tax),
    netWeekly: wk(net),
  };
}

/** All four strategies as one week of money each, in a fixed order. */
export function compareWeekly(input: SimInput): WeeklyBreakdown[] {
  return (["payoff", "recycle", "holdPI", "holdIO"] as StrategyId[]).map((s) =>
    weeklyBreakdown(s, input),
  );
}

export type Comparison = {
  strategy: StrategyId;
  label: string;
  netWorth: number;
  equity: number;
  debt: number;
  properties: number;
  weeklyCashflow: number;
  lvr: number;
  debtFreeYear: number | null;
  totalInterest: number;
  /** Plain-language trade-off — what you give up to get the number above. */
  tradeoff: string;
};

const TRADEOFF: Record<StrategyId, string> = {
  payoff: "Lowest risk and the fastest route to no mortgage. One property, so growth only compounds on one asset.",
  recycle: "Fastest net-worth growth, and the most exposed: more debt, tighter cashflow, and a rate rise hits every property at once.",
  holdPI: "Debt falls every month and you keep a spare bedroom count you're not living in. Weakest cashflow of the four.",
  holdIO: "Best cashflow while it lasts. You own no more of the house in five years than you do today, and the payment steps up when interest-only ends.",
};

/** All four strategies from the same starting position, at the same horizon. */
export function compareStrategies(input: SimInput): Comparison[] {
  const ids: StrategyId[] = ["payoff", "recycle", "holdPI", "holdIO"];
  return ids
    .map((id) => {
      const sim = simulate(id, input);
      return {
        strategy: id,
        label: sim.label,
        netWorth: sim.final.netWorth,
        equity: sim.final.equity,
        debt: sim.final.debt,
        properties: sim.final.properties,
        weeklyCashflow: sim.final.weeklyCashflow,
        lvr: sim.final.lvr,
        debtFreeYear: sim.debtFreeYear,
        totalInterest: sim.totalInterest,
        tradeoff: TRADEOFF[id],
      };
    })
    .sort((a, b) => b.netWorth - a.netWorth);
}

// --------------------------------------------------------------------------- //
// Stress testing
// --------------------------------------------------------------------------- //
export type Shock = {
  label: string;
  /** Percentage points added to the mortgage rate. */
  ratePoints?: number;
  /** Fractional fall in property value, e.g. 0.15 for -15%. */
  valueFall?: number;
  /** Extra weeks vacant per year. */
  vacancyWeeks?: number;
  /** Fractional cut to rent. */
  rentCut?: number;
};

export const STANDARD_SHOCKS: Shock[] = [
  { label: "Rates +2%", ratePoints: 2 },
  { label: "Rates +3%", ratePoints: 3 },
  { label: "Values −15%", valueFall: 0.15 },
  { label: "8 weeks vacant", vacancyWeeks: 8 },
  { label: "Rates +2% and values −15%", ratePoints: 2, valueFall: 0.15 },
  { label: "Rates +3%, values −20%, rent −10%", ratePoints: 3, valueFall: 0.2, rentCut: 0.1 },
];

export type StressRow = {
  label: string;
  weeklyCashflow: number;
  /** Change in weekly cashflow against the base case. */
  cashflowDelta: number;
  lvr: number;
  netWorth: number;
  /** Above 80% LVR a bank can decline to refinance; above 100% you are underwater. */
  verdict: "fine" | "tight" | "trouble";
  note: string;
};

/**
 * The same strategy under a set of shocks, one year out.
 *
 * A plan that only works at today's rate is not a plan, and the sequence that
 * breaks people is a rate rise and a value fall arriving together — which is why
 * the combined shocks are in the standard set.
 */
export function stressTest(
  strategy: StrategyId,
  input: SimInput,
  shocks: Shock[] = STANDARD_SHOCKS,
): { base: StressRow; rows: StressRow[] } {
  const oneYear = { ...input, years: 1 };

  const run = (shock: Shock): StressRow => {
    const shocked: SimInput = {
      ...oneYear,
      annualRate: input.annualRate + (shock.ratePoints ?? 0) / 100,
      growthPct: shock.valueFall ? -shock.valueFall * 100 : input.growthPct,
      vacancyWeeks: (input.vacancyWeeks ?? DEFAULTS.vacancyWeeks) + (shock.vacancyWeeks ?? 0),
      roomWeeklyRent: input.roomWeeklyRent * (1 - (shock.rentCut ?? 0)),
      wholeHouseWeeklyRent: input.wholeHouseWeeklyRent * (1 - (shock.rentCut ?? 0)),
    };
    const sim = simulate(strategy, shocked);
    const f = sim.final;
    const verdict: StressRow["verdict"] =
      f.lvr >= 95 || f.weeklyCashflow < -300 ? "trouble"
      : f.lvr >= 80 || f.weeklyCashflow < 0 ? "tight"
      : "fine";
    const note =
      f.lvr >= 95 ? "Little or no equity left — refinancing is off the table."
      : f.weeklyCashflow < 0 ? `You top it up $${Math.abs(f.weeklyCashflow).toFixed(0)}/wk from salary.`
      : "Holds without help from your salary.";
    return {
      label: shock.label,
      weeklyCashflow: f.weeklyCashflow,
      cashflowDelta: 0,
      lvr: f.lvr,
      netWorth: f.netWorth,
      verdict,
      note,
    };
  };

  const base = run({ label: "Today" });
  const rows = shocks.map((s) => {
    const row = run(s);
    row.cashflowDelta = round(row.weeklyCashflow - base.weeklyCashflow);
    return row;
  });
  return { base, rows };
}
