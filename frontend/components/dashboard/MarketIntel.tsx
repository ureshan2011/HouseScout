"use client";

import type { Model } from "@/lib/predict";
import { INK, SERIES, compactMoney } from "@/lib/viz";

// Below this, the fitted effect is inside the model's noise: say so rather than print
// "-$2,000 for a garage", which reads as a finding and is not one.
const NOISE_DOLLARS = 5_000;

/**
 * What the valuation model learned from this scrape, in plain language: what a standard
 * home is worth suburb by suburb, what each feature adds, and how far to trust it.
 * Everything here comes from model.json (scripts/hedonic.py), so it changes with the data.
 */
export function MarketIntel({ model, budget }: { model: Model; budget: number }) {
  const intel = model.intel;
  if (!intel || !intel.ladder.length) return null;
  const { reference: ref } = intel;
  const acc = model.accuracy;
  const ladder = intel.ladder;
  const max = Math.max(...ladder.map((r) => r.value), budget);
  const min = Math.min(...ladder.map((r) => r.value)) * 0.85;
  const under = ladder.filter((r) => r.value <= budget);
  const pct = (v: number) => `${Math.max(2, ((v - min) / (max - min)) * 100)}%`;

  return (
    <section className="card p-4 md:p-5" aria-label="What the market is saying">
      <h2 className="font-bold tracking-tight">What the market is saying</h2>
      <p className="mt-0.5 text-sm text-slate-600">
        Learned from <strong className="text-slate-900">{model.n_train}</strong> published asking prices in this
        scrape. A standard home here — {ref.bedrooms} bed, {ref.bathrooms} bath on a {Math.round(ref.land_m2)} m² section — is valued at <strong className="text-slate-900">{compactMoney(ref.value)}</strong>.
      </p>

      <div className="mt-4 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <h3 className="text-sm font-semibold">The same home, suburb by suburb</h3>
          <p className="mb-3 text-xs text-slate-500">
            {under.length > 0 ? (
              <>
                {under.length} suburb{under.length === 1 ? "" : "s"} price a standard home within your{" "}
                {compactMoney(budget)} cap: {under.map((r) => r.suburb).join(", ")}.
              </>
            ) : (
              <>No suburb with enough sales prices a standard home under your {compactMoney(budget)} cap — look for smaller homes.</>
            )}
          </p>
          <ul className="space-y-1.5" aria-label="Value of a standard home by suburb">
            {ladder.map((r) => {
              const within = r.value <= budget;
              return (
                <li key={r.suburb} className="grid grid-cols-[6.5rem_1fr_3.5rem] items-center gap-2 text-sm">
                  <span className="truncate" title={`${r.n} priced listings`}>
                    {r.suburb}
                  </span>
                  <span className="relative h-3 rounded bg-slate-100">
                    <span
                      className="absolute inset-y-0 left-0 rounded"
                      style={{ width: pct(r.value), background: within ? SERIES[0] : INK.quiet }}
                    />
                    <span
                      className="absolute inset-y-[-3px] w-px bg-slate-900"
                      style={{ left: pct(budget) }}
                      aria-hidden
                    />
                  </span>
                  <span className="text-right tabular-nums text-slate-700">{compactMoney(r.value)}</span>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-xs text-slate-500">
            Black line: your cap. Suburbs need 3+ priced listings to appear; fewer and the figure leans on
            the district.
          </p>
        </div>

        <div className="space-y-5">
          <div>
            <h3 className="text-sm font-semibold">What adds value here</h3>
            <ul className="mt-2 space-y-1 text-sm">
              {intel.effects.map((e) => (
                <li key={e.label} className="flex justify-between gap-3">
                  <span className="text-slate-600">{e.label}</span>
                  <span className="tabular-nums font-medium">
                    {Math.abs(e.dollars) < NOISE_DOLLARS ? (
                      <span className="font-normal text-slate-400">no clear effect</span>
                    ) : (
                      `${e.dollars > 0 ? "+" : "−"}${compactMoney(Math.abs(e.dollars))}`
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-slate-500">
              Each holds everything else equal. Bedrooms partly stand in for floor area, which most listings
              don&apos;t state.
            </p>
          </div>

          {acc && (
            <div>
              <h3 className="text-sm font-semibold">How far to trust it</h3>
              <p className="mt-1 text-sm text-slate-600">
                Tested on prices it hadn&apos;t seen: typical miss{" "}
                <strong className="text-slate-900">{acc.median_ape_pct}%</strong>,{" "}
                {acc.within_10_pct}% of homes within 10% and {acc.within_20_pct}% within 20%.
                {intel.floor_quote_premium_pct > 0 && (
                  <> &ldquo;Enquiries over&rdquo; quotes sit about {intel.floor_quote_premium_pct}% under value.</>
                )}
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
