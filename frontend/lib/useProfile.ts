"use client";

import { useEffect, useState } from "react";
import { BuyerProfile, FACTORY_DEFAULTS, loadProfile, onProfileChange } from "./criteria";
import { SimInput } from "./strategy";

/**
 * The buyer's numbers, live.
 *
 * Every surface that shows money reads through this, so changing the deposit in
 * the header updates the listing you are looking at, the Strategy Lab and the
 * scores behind it at the same moment — without a reload and without each page
 * keeping its own stale copy.
 *
 * Starts on FACTORY_DEFAULTS so the server-rendered HTML and the first client
 * render agree; the stored profile lands on the effect immediately after.
 */
export function useProfile(): BuyerProfile {
  const [profile, setProfile] = useState<BuyerProfile>(FACTORY_DEFAULTS);

  useEffect(() => {
    setProfile(loadProfile());
    const off = onProfileChange(setProfile);
    // Another tab editing the same profile counts as a change here too.
    const sync = () => setProfile(loadProfile());
    window.addEventListener("storage", sync);
    return () => {
      off();
      window.removeEventListener("storage", sync);
    };
  }, []);

  return profile;
}

/**
 * A profile, as engine input.
 *
 * One conversion for the whole app: if the buyer's rates bill or vacancy
 * allowance lives in the profile, it reaches every projection that uses it,
 * rather than each call site re-deciding what to assume.
 */
export function scenarioInput(
  p: BuyerProfile,
  overrides: Partial<SimInput> & Pick<SimInput, "price" | "bedrooms" | "wholeHouseWeeklyRent">,
): SimInput {
  return {
    deposit: Math.min(p.deposit, overrides.price),
    annualRate: p.annual_rate,
    termYears: p.term_years,
    roomWeeklyRent: p.weekly_rent,
    growthPct: p.growth_pct,
    grossIncome: p.gross_income,
    years: p.horizon_years,
    marginalTaxRate: p.marginal_tax_rate,
    ratesAnnual: p.rates_annual,
    insuranceAnnual: p.insurance_annual,
    maintenancePct: p.maintenance_pct,
    managementPct: p.management_pct,
    vacancyWeeks: p.vacancy_weeks,
    interestOnlyYears: p.interest_only_years,
    livingCostsMonthly: p.living_costs_monthly,
    ...overrides,
  };
}
