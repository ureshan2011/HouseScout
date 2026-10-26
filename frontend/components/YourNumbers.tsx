"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { BuyerProfile, isDefault, resetProfile, saveProfile } from "@/lib/criteria";
import { useProfile } from "@/lib/useProfile";
import { money } from "@/lib/viz";
import { Term } from "@/components/viz/Primitives";

/**
 * The buyer's numbers, editable from every page.
 *
 * These drive every dollar figure in the app, so burying them on a settings page
 * meant most visitors read the whole site against someone else's deposit. The
 * header button carries the two that matter most, and the panel edits the rest in
 * place — changes save and re-render everything as you drag.
 */
export function YourNumbers() {
  const p = useProfile();
  const [open, setOpen] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [mounted, setMounted] = useState(false);
  const untouched = isDefault(p);

  useEffect(() => setMounted(true), []);

  // Escape closes, and the page behind must not scroll while the panel is over it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  const set = (patch: Partial<BuyerProfile>) => saveProfile(patch);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="press relative flex min-h-[2.75rem] shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border border-slate-300 px-3 py-1.5 text-left text-sm transition hover:border-slate-400 hover:bg-slate-50"
        aria-haspopup="dialog"
      >
        <span aria-hidden>💰</span>
        <span className="hidden sm:inline">
          <span className="font-medium text-slate-900">{money(p.deposit)}</span>
          <span className="text-slate-500"> deposit · {(p.annual_rate * 100).toFixed(2)}%</span>
        </span>
        {/* On a phone the header has room for one figure, not a sentence. */}
        <span className="font-medium text-slate-900 sm:hidden">{money(p.deposit)}</span>
        {untouched && (
          <span
            className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-amber-500"
            title="Still using the example numbers"
          />
        )}
      </button>

      {/* Portalled to <body>: the site header uses backdrop-blur, which makes it a
          containing block for position:fixed — rendering the overlay inside it
          would trap the panel in the header's box instead of the viewport. */}
      {open && mounted && createPortal(
        <div className="fixed inset-0 z-[60] flex flex-col justify-end md:flex-row md:justify-end" role="dialog" aria-modal="true" aria-label="Your numbers">
          <button
            type="button"
            aria-label="Close"
            className="sheet-backdrop absolute inset-0 bg-slate-900/40 md:bg-slate-900/30"
            onClick={() => setOpen(false)}
          />
          {/* scroll-pt keeps the sticky header from landing on top of whatever
              was just scrolled to — without it, controls near the top of the
              viewport sit under the header and taps hit the header instead. */}
          {/* A bottom sheet on phones (thumb-reachable, dismissed by tapping outside), a
              side panel from `md` up. `dvh` so Safari's collapsing toolbars don't push the
              Done button off screen. */}
          <div className="sheet relative flex max-h-[92dvh] w-full scroll-pt-24 flex-col overflow-y-auto rounded-t-2xl bg-white shadow-xl md:max-h-none md:max-w-md md:rounded-none md:[animation:none]">
            <div className="sticky top-0 z-20 flex justify-center bg-white pt-2 md:hidden" aria-hidden>
              <span className="h-1.5 w-10 rounded-full bg-slate-300" />
            </div>
            <header className="sticky top-4 z-10 flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3 md:top-0 md:py-4">
              <div>
                <h2 className="font-semibold">Your numbers</h2>
                <p className="text-xs text-slate-500">
                  Everything in HouseScout is worked out from these. Saved on this device.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="press -mr-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close"
              >
                ✕
              </button>
            </header>

            <div className="space-y-6 px-5 py-5">
              {untouched && (
                <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
                  These are example numbers. Change them to yours and every figure on the site
                  updates — match scores, weekly costs, projections, all of it.
                </p>
              )}

              <Group title="What you've got">
                <Slider
                  label="Deposit"
                  value={p.deposit}
                  onChange={(v) => set({ deposit: v })}
                  min={0}
                  max={400_000}
                  step={5_000}
                  format={money}
                />
                <Slider
                  label="Household income before tax"
                  hint="Banks work backwards from this. It's usually what limits you, not the deposit."
                  value={p.gross_income}
                  onChange={(v) => set({ gross_income: v })}
                  min={30_000}
                  max={400_000}
                  step={5_000}
                  format={money}
                />
                <Slider
                  label="Most you'd pay for a house"
                  hint="Listings above this fail the filters."
                  value={p.max_price}
                  onChange={(v) => set({ max_price: v, preapproval: Math.min(p.preapproval, v) })}
                  min={100_000}
                  max={2_000_000}
                  step={10_000}
                  format={money}
                />
              </Group>

              <Group title="The mortgage">
                <Slider
                  label="Interest rate"
                  value={p.annual_rate * 100}
                  onChange={(v) => set({ annual_rate: v / 100 })}
                  min={2}
                  max={12}
                  step={0.05}
                  format={(v) => `${v.toFixed(2)}%`}
                />
                <Slider
                  label="Loan term"
                  value={p.term_years}
                  onChange={(v) => set({ term_years: v })}
                  min={5}
                  max={30}
                  step={1}
                  format={(v) => `${v} years`}
                />
                <Slider
                  label="Interest-only period"
                  hint={<>How long you&apos;d pay <Term k="interest-only">interest only</Term> before normal repayments start.</>}
                  value={p.interest_only_years}
                  onChange={(v) => set({ interest_only_years: v })}
                  min={0}
                  max={10}
                  step={1}
                  format={(v) => (v === 0 ? "none" : `${v} years`)}
                />
              </Group>

              <Group title="What it earns">
                <Slider
                  label="Room rent, per week"
                  hint={<>What one <Term k="boarder">boarder</Term> pays you.</>}
                  value={p.weekly_rent}
                  onChange={(v) => set({ weekly_rent: v })}
                  min={80}
                  max={500}
                  step={5}
                  format={(v) => `${money(v)}/wk`}
                />
                <Slider
                  label="Weeks empty each year"
                  hint={<><Term k="vacancy">Vacancy</Term> allowance between tenants.</>}
                  value={p.vacancy_weeks}
                  onChange={(v) => set({ vacancy_weeks: v })}
                  min={0}
                  max={12}
                  step={1}
                  format={(v) => (v === 1 ? "1 week" : `${v} weeks`)}
                />
                <Slider
                  label="House prices rise by"
                  hint="Used by the Strategy Lab. Individual listings use their own suburb's rate."
                  value={p.growth_pct}
                  onChange={(v) => set({ growth_pct: v })}
                  min={-5}
                  max={12}
                  step={0.5}
                  format={(v) => `${v}% a year`}
                />
              </Group>

              <div>
                <button
                  type="button"
                  onClick={() => setShowAdvanced((v) => !v)}
                  className="press -ml-1 min-h-[2.75rem] px-1 text-sm font-medium text-slate-600 underline decoration-dotted hover:text-slate-900"
                >
                  {showAdvanced ? "Hide running costs and tax" : "Running costs and tax"}
                </button>
                {showAdvanced && (
                  <div className="mt-4 space-y-6">
                    <Group title="What it costs to own">
                      <Slider
                        label="Council rates"
                        value={p.rates_annual}
                        onChange={(v) => set({ rates_annual: v })}
                        min={0}
                        max={12_000}
                        step={100}
                        format={(v) => `${money(v)} a year`}
                      />
                      <Slider
                        label="Insurance"
                        value={p.insurance_annual}
                        onChange={(v) => set({ insurance_annual: v })}
                        min={0}
                        max={12_000}
                        step={100}
                        format={(v) => `${money(v)} a year`}
                      />
                      <Slider
                        label="Upkeep"
                        hint="A share of the house's value each year. 1% is the usual rule of thumb."
                        value={p.maintenance_pct * 100}
                        onChange={(v) => set({ maintenance_pct: v / 100 })}
                        min={0}
                        max={3}
                        step={0.1}
                        format={(v) => `${v.toFixed(1)}% of value`}
                      />
                      <Slider
                        label="Property manager"
                        hint="A share of the rent. Zero if you manage it yourself."
                        value={p.management_pct * 100}
                        onChange={(v) => set({ management_pct: v / 100 })}
                        min={0}
                        max={12}
                        step={0.5}
                        format={(v) => (v === 0 ? "self-managed" : `${v}% of rent`)}
                      />
                      <Slider
                        label="Your living costs"
                        hint="What you spend a month. The bank's affordability test uses this."
                        value={p.living_costs_monthly}
                        onChange={(v) => set({ living_costs_monthly: v })}
                        min={0}
                        max={10_000}
                        step={100}
                        format={(v) => `${money(v)} a month`}
                      />
                    </Group>
                    <Group title="Tax">
                      <Slider
                        label="Your top tax rate"
                        hint="What rental profit gets taxed at. Boarder income is tax-free up to the IRD threshold."
                        value={p.marginal_tax_rate * 100}
                        onChange={(v) => set({ marginal_tax_rate: v / 100 })}
                        min={0}
                        max={45}
                        step={1}
                        format={(v) => `${v}%`}
                      />
                    </Group>
                    <Group title="How far ahead to look">
                      <Slider
                        label="Projection horizon"
                        value={p.horizon_years}
                        onChange={(v) => set({ horizon_years: v })}
                        min={5}
                        max={30}
                        step={1}
                        format={(v) => `${v} years`}
                      />
                    </Group>
                  </div>
                )}
              </div>
            </div>

            <footer className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
              <Link href="/settings" className="text-xs text-slate-500 underline hover:text-slate-800">
                Filters &amp; plan settings
              </Link>
              <div className="flex gap-2">
                {!untouched && (
                  <button type="button" className="btn-ghost text-xs" onClick={() => resetProfile()}>
                    Reset
                  </button>
                )}
                <button type="button" className="btn" onClick={() => setOpen(false)}>
                  Done
                </button>
              </div>
            </footer>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h3>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

/**
 * A slider with the value spelled out, plus a number box for anyone who knows
 * exactly what they want. Dragging updates the whole app live.
 */
function Slider({
  label,
  hint,
  value,
  onChange,
  min,
  max,
  step,
  format,
}: {
  label: string;
  hint?: React.ReactNode;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
}) {
  // Typing past the slider's range is allowed — the range is a comfortable span,
  // not a limit on what a buyer is permitted to model.
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);

  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-slate-700">{label}</span>
        <span className="text-sm font-semibold tabular-nums text-slate-900">{format(value)}</span>
      </span>
      <span className="mt-1.5 flex items-center gap-2">
        <input
          type="range"
          className="min-w-0 flex-1 accent-brand"
          min={min}
          max={max}
          step={step}
          value={Math.min(max, Math.max(min, value))}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={label}
        />
        <input
          type="number"
          className="input w-24 shrink-0 px-2 py-1 text-xs tabular-nums"
          inputMode="decimal"
          step={step}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const n = Number(e.target.value);
            if (e.target.value !== "" && Number.isFinite(n)) onChange(n);
          }}
          onBlur={() => setText(String(value))}
          aria-label={`${label}, exact value`}
        />
      </span>
      {hint && <span className="mt-0.5 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}
