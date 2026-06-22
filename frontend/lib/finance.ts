// Financial engine — a 1:1 TypeScript port of backend/app/finance.py so the whole
// app can run client-side (GitHub Pages: no backend). Pure functions, no I/O.
//
// Models the buyer's strategy: live in the house, rent spare rooms to boarders, and
// funnel that income into extra mortgage repayments to be debt-free as fast as possible.
//
// NZ-specific: the IRD "standard-cost" method makes boarder income up to a weekly
// threshold per boarder effectively tax-free (max 4 boarders). 2025-26 threshold = $245/wk.

// IRD standard-cost weekly amount per boarder (2025-26 income year) and boarder cap.
export const BOARDER_TAX_FREE_WEEKLY = 245.0;
export const MAX_BOARDERS = 4;
export const WEEKS_PER_YEAR = 52;
export const MONTHS_PER_YEAR = 12;

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
}

// --------------------------------------------------------------------------- //
// Mortgage
// --------------------------------------------------------------------------- //
export function monthlyPayment(principal: number, annualRate: number, termYears: number): number {
  // Standard amortising P&I monthly payment.
  if (principal <= 0) return 0.0;
  const n = termYears * MONTHS_PER_YEAR;
  const r = annualRate / MONTHS_PER_YEAR;
  if (r === 0) return principal / n;
  return (principal * r * (1 + r) ** n) / ((1 + r) ** n - 1);
}

export type Amortisation = {
  monthly_payment: number;
  payoff_months: number | null;
  payoff_years: number | null;
  total_interest: number | null;
  yearly_balance: number[];
};

export function amortise(
  principal: number,
  annualRate: number,
  termYears: number,
  extraMonthly = 0.0,
): Amortisation {
  // Run an amortisation schedule, optionally with a fixed extra monthly payment.
  const basePmt = monthlyPayment(principal, annualRate, termYears);
  const r = annualRate / MONTHS_PER_YEAR;
  let balance = principal;
  let totalInterest = 0.0;
  let months = 0;
  const yearlyBalance: number[] = [round(balance)];
  const maxMonths = termYears * MONTHS_PER_YEAR + 1;

  while (balance > 0.005 && months < maxMonths * 2) {
    const interest = balance * r;
    const payment = basePmt + extraMonthly;
    let principalPaid = payment - interest;
    if (principalPaid <= 0) {
      // payment can't cover interest -> never pays off
      return {
        monthly_payment: round(basePmt),
        payoff_months: null,
        payoff_years: null,
        total_interest: null,
        yearly_balance: yearlyBalance,
      };
    }
    if (principalPaid > balance) principalPaid = balance; // final partial payment
    balance -= principalPaid;
    totalInterest += interest;
    months += 1;
    if (months % 12 === 0) yearlyBalance.push(round(Math.max(balance, 0.0)));
  }

  if (months % 12 !== 0) yearlyBalance.push(round(Math.max(balance, 0.0)));

  return {
    monthly_payment: round(basePmt),
    payoff_months: months,
    payoff_years: round(months / 12, 1),
    total_interest: round(totalInterest),
    yearly_balance: yearlyBalance,
  };
}

// --------------------------------------------------------------------------- //
// Boarder income (rent the spare rooms)
// --------------------------------------------------------------------------- //
export function rentableRooms(bedrooms: number | null | undefined): number {
  // You keep one bedroom; the rest can host boarders (capped at IRD's 4).
  if (!bedrooms || bedrooms < 2) return 0;
  return Math.min(bedrooms - 1, MAX_BOARDERS);
}

export type BoarderIncome = {
  rentable_rooms: number;
  weekly_gross: number;
  weekly_tax_free: number;
  weekly_taxable: number;
  annual_gross: number;
};

export function boarderIncome(
  bedrooms: number | null | undefined,
  weeklyRent: number,
  occupancy = 1.0,
): BoarderIncome {
  const rooms = rentableRooms(bedrooms);
  const grossWeekly = rooms * weeklyRent * occupancy;
  const taxFreeWeekly = Math.min(weeklyRent, BOARDER_TAX_FREE_WEEKLY) * rooms * occupancy;
  const taxableWeekly = Math.max(grossWeekly - taxFreeWeekly, 0.0);
  return {
    rentable_rooms: rooms,
    weekly_gross: round(grossWeekly),
    weekly_tax_free: round(taxFreeWeekly),
    weekly_taxable: round(taxableWeekly),
    annual_gross: round(grossWeekly * WEEKS_PER_YEAR),
  };
}

// --------------------------------------------------------------------------- //
// Full scenario
// --------------------------------------------------------------------------- //
export type Scenario = {
  price: number;
  deposit: number;
  annual_rate: number;
  term_years: number;
  bedrooms: number | null | undefined;
  weekly_rent: number;
  occupancy?: number;
  annual_rates_bill?: number; // council rates
  annual_insurance?: number;
  annual_maintenance_pct?: number; // of value
  reinvest_boarder_income?: boolean;
};

export type FinanceResult = {
  loan: number;
  monthly_payment: number;
  boarder: BoarderIncome;
  monthly_boarder_income: number;
  monthly_holding_costs: number;
  net_monthly_outlay: number;
  covers_mortgage: boolean;
  gross_yield_pct: number;
  net_annual_cashflow: number;
  standard: Amortisation;
  accelerated: Amortisation;
  interest_saved: number | null;
  years_saved: number | null;
};

export function analyse(s: Scenario): FinanceResult {
  // Produce the full financial picture for a listing under the rent-rooms strategy.
  const occupancy = s.occupancy ?? 1.0;
  const annualRatesBill = s.annual_rates_bill ?? 3200.0;
  const annualInsurance = s.annual_insurance ?? 2200.0;
  const annualMaintenancePct = s.annual_maintenance_pct ?? 0.01;
  const reinvest = s.reinvest_boarder_income ?? true;

  const loan = Math.max(s.price - s.deposit, 0.0);
  const base = amortise(loan, s.annual_rate, s.term_years);
  const income = boarderIncome(s.bedrooms, s.weekly_rent, occupancy);

  const monthlyPmt = base.monthly_payment;
  const monthlyIncome = (income.weekly_gross * WEEKS_PER_YEAR) / MONTHS_PER_YEAR;
  const monthlyHolding =
    (annualRatesBill + annualInsurance + s.price * annualMaintenancePct) / MONTHS_PER_YEAR;

  // Surplus available to accelerate the mortgage (income minus holding costs).
  const netSurplusMonthly = Math.max(monthlyIncome - monthlyHolding, 0.0);
  const extra = reinvest ? netSurplusMonthly : 0.0;
  const accelerated = amortise(loan, s.annual_rate, s.term_years, extra);

  // Out-of-pocket = mortgage + holding - boarder income (negative => income covers it).
  const netMonthlyOutlay = monthlyPmt + monthlyHolding - monthlyIncome;

  const grossYield = s.price ? (income.annual_gross / s.price) * 100 : 0.0;
  const annualCosts = monthlyPmt * MONTHS_PER_YEAR + monthlyHolding * MONTHS_PER_YEAR;
  const netAnnual = income.annual_gross - annualCosts;

  let interestSaved: number | null = null;
  let yearsSaved: number | null = null;
  if (base.total_interest && accelerated.total_interest !== null) {
    interestSaved = round(base.total_interest - accelerated.total_interest);
  }
  if (base.payoff_years && accelerated.payoff_years) {
    yearsSaved = round(base.payoff_years - accelerated.payoff_years, 1);
  }

  return {
    loan: round(loan),
    monthly_payment: monthlyPmt,
    boarder: income,
    monthly_boarder_income: round(monthlyIncome),
    monthly_holding_costs: round(monthlyHolding),
    net_monthly_outlay: round(netMonthlyOutlay),
    covers_mortgage: netMonthlyOutlay <= 0,
    gross_yield_pct: round(grossYield),
    net_annual_cashflow: round(netAnnual),
    standard: base,
    accelerated,
    interest_saved: interestSaved,
    years_saved: yearsSaved,
  };
}
