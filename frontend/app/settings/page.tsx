"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Model, loadModel } from "@/lib/predict";
import { money } from "@/lib/viz";
import { PLANS, applyLicence, clearLicence, getLicence, planFor } from "@/lib/subscription";
import { useTier } from "@/components/Gate";
import {
  BuyerProfile,
  FACTORY_DEFAULTS,
  isDefault,
  loadProfile,
  resetProfile,
  saveProfile,
} from "@/lib/criteria";

export default function Settings() {
  const [profile, setProfile] = useState<BuyerProfile>(FACTORY_DEFAULTS);
  const [model, setModel] = useState<Model | null>(null);
  const [licence, setLicence] = useState("");
  const [msg, setMsg] = useState("");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const tier = useTier();

  useEffect(() => {
    // localStorage is only readable in the browser, so the real profile lands after
    // hydration; until then the factory defaults render (matching the server HTML).
    setProfile(loadProfile());
    loadModel().then(setModel);
    setLicence(getLicence());
  }, []);

  function update(patch: Partial<BuyerProfile>) {
    setProfile(saveProfile(patch));
    setSavedAt(Date.now());
  }

  function redeem() {
    const granted = applyLicence(licence);
    setMsg(granted ? `Unlocked ${planFor(granted).name}.` : "That key doesn't look right (HS-PRO-XXXX).");
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      <section className="card p-4">
        <h2 className="mb-2 font-semibold">Your plan</h2>
        <p className="text-sm text-slate-600">
          Current plan: <strong>{tier ? planFor(tier).name : "…"}</strong>.{" "}
          <Link href="/pricing" className="text-brand-dark underline">
            Compare plans
          </Link>
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            className="input w-full max-w-xs"
            value={licence}
            onChange={(e) => setLicence(e.target.value)}
            placeholder="HS-PRO-XXXX"
            aria-label="Licence key"
          />
          <button className="btn" onClick={redeem}>
            Redeem key
          </button>
          {tier !== "free" && (
            <button
              className="btn-ghost"
              onClick={() => {
                clearLicence();
                setLicence("");
                setMsg("Reverted to the free plan.");
              }}
            >
              Switch to free
            </button>
          )}
        </div>
        {msg && <p className="mt-2 text-xs text-slate-500">{msg}</p>}
        <p className="mt-2 text-xs text-slate-400">
          Plans are stored on this device only — there is no account and no payment processor
          connected yet. See{" "}
          <Link href="/pricing" className="underline">
            Plans
          </Link>{" "}
          for what that means.
        </p>
      </section>

      <section className="card p-4">
        <h2 className="mb-2 font-semibold">Analysis engine</h2>
        <p className="text-sm text-slate-600">
          All analysis runs <strong>inside the app</strong> — there is no model server, no API key
          and no external service. The valuation, rent, negotiation and growth figures come from
          HouseScout&apos;s own model, trained at build time and evaluated in your browser; the
          written per-listing analysis is generated during the build from each listing&apos;s
          numbers. Everything works offline.
        </p>
        {model && (
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            <Stat label="Model version" value={String(model.version)} />
            <Stat label="Trained" value={model.generated_at?.slice(0, 10) || "—"} />
            <Stat
              label="Calibrated on"
              value={`${model.n_train} published asking price${model.n_train === 1 ? "" : "s"}`}
            />
            <Stat
              label="Confidence"
              value={`${model.confidence}${model.cv_mae_pct != null ? ` (±${model.cv_mae_pct}% CV error)` : ""}`}
            />
          </dl>
        )}
        <p className="mt-3 text-xs text-slate-500">
          Confidence is low while few listings publish an asking price — most NZ stock in this
          price bracket sells by auction or deadline sale. The model shrinks toward documented
          valuation relationships rather than overfitting a small sample, and says so rather than
          presenting a false precision.
        </p>
      </section>

      <section className="card p-4">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold">What counts as a match</h2>
          {savedAt && <span className="text-xs text-emerald-600">Saved — scores updated</span>}
        </div>
        <p className="text-sm text-slate-500">
          These decide which listings pass and how they rank. The money behind every figure lives
          under <strong>💰 Your numbers</strong> at the top of any page.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <NumberField
            label="Maximum price"
            hint="Listings above this fail the hard filter."
            prefix="$"
            step={10_000}
            value={profile.max_price}
            onChange={(v) => update({ max_price: v })}
          />
          <NumberField
            label="Pre-approval"
            hint="What the bank has agreed to lend."
            prefix="$"
            step={10_000}
            value={profile.preapproval}
            onChange={(v) => update({ preapproval: v })}
          />
          <NumberField
            label="Minimum backyard"
            hint="Land area a section must reach."
            suffix="m²"
            step={10}
            value={profile.min_backyard_m2}
            onChange={(v) => update({ min_backyard_m2: v })}
          />
        </div>

        <div className="mt-4 space-y-2 border-t border-slate-200 pt-4">
          <ToggleField
            label="Require a garage"
            hint="Listings with no garage fail the filters rather than just scoring lower."
            checked={profile.require_garage}
            onChange={(v) => update({ require_garage: v })}
          />
          <ToggleField
            label="Require a backyard"
            hint="Excludes apartments and any section under the minimum above."
            checked={profile.require_backyard}
            onChange={(v) => update({ require_backyard: v })}
          />
          <ToggleField
            label="Allow townhouses"
            hint="Allowed but scored lower than a standalone house when on."
            checked={profile.allow_townhouse}
            onChange={(v) => update({ allow_townhouse: v })}
          />
        </div>

        {!isDefault(profile) && (
          <button
            className="btn-ghost mt-4"
            onClick={() => {
              setProfile(resetProfile());
              setSavedAt(Date.now());
            }}
          >
            Reset everything to defaults
          </button>
        )}
      </section>

      <section className="card p-4">
        <h2 className="mb-1 font-semibold">Your numbers, in full</h2>
        <p className="mb-3 text-sm text-slate-500">
          Every dollar figure on the site is worked out from these. Edit them here, or from{" "}
          <strong>💰 Your numbers</strong> on any page.
        </p>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Fact k="Deposit" v={money(profile.deposit)} />
          <Fact k="Household income before tax" v={money(profile.gross_income)} />
          <Fact k="Interest rate" v={`${(profile.annual_rate * 100).toFixed(2)}%`} />
          <Fact k="Loan term" v={`${profile.term_years} years`} />
          <Fact k="Interest-only period" v={profile.interest_only_years ? `${profile.interest_only_years} years` : "none"} />
          <Fact k="Room rent" v={`${money(profile.weekly_rent)}/wk`} />
          <Fact k="Weeks empty each year" v={`${profile.vacancy_weeks}`} />
          <Fact k="House price growth" v={`${profile.growth_pct}% a year`} />
          <Fact k="Council rates" v={`${money(profile.rates_annual)}/yr`} />
          <Fact k="Insurance" v={`${money(profile.insurance_annual)}/yr`} />
          <Fact k="Upkeep" v={`${(profile.maintenance_pct * 100).toFixed(1)}% of value`} />
          <Fact k="Property manager" v={profile.management_pct ? `${(profile.management_pct * 100).toFixed(1)}% of rent` : "self-managed"} />
          <Fact k="Your living costs" v={`${money(profile.living_costs_monthly)}/mo`} />
          <Fact k="Top tax rate" v={`${Math.round(profile.marginal_tax_rate * 100)}%`} />
          <Fact k="Projection horizon" v={`${profile.horizon_years} years`} />
        </dl>
      </section>

      <section className="card p-4">
        <h2 className="mb-2 font-semibold">About this build</h2>
        <p className="text-sm text-slate-600">
          This is the static build of HouseScout. Listings are scraped from public NZ property
          sources when the site builds, with photos downloaded and self-hosted; scoring, valuation
          and all financial analysis then run entirely in your browser. Where a listing publishes
          no price, HouseScout&apos;s estimate is shown and labelled as such. For LINZ land
          enrichment and a persistent database, run the optional Python backend (see README).
        </p>
        <p className="mt-2 text-sm text-slate-600">
          Which districts a build covers is set by <code className="rounded bg-slate-100 px-1">SCRAPE_REGIONS</code>{" "}
          in the deploy workflow — any of the 59 verified locations in{" "}
          <code className="rounded bg-slate-100 px-1">scraper/regions.py</code>, a whole region, an
          island, or the entire country. The Listings page filters by whichever districts this
          build actually scraped.
        </p>
      </section>
    </div>
  );
}

function NumberField({
  label,
  hint,
  prefix,
  suffix,
  step,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  prefix?: string;
  suffix?: string;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  // Held as text while editing so a half-typed value ("4.") doesn't get coerced and
  // fight the cursor; committed to the profile only when it parses.
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);

  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <span className="flex items-center gap-1">
        {prefix && <span className="text-sm text-slate-400">{prefix}</span>}
        <input
          className="input w-full"
          type="number"
          inputMode="decimal"
          step={step}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const n = Number(e.target.value);
            if (e.target.value !== "" && Number.isFinite(n)) onChange(n);
          }}
          onBlur={() => setText(String(value))}
        />
        {suffix && <span className="whitespace-nowrap text-sm text-slate-400">{suffix}</span>}
      </span>
      {hint && <span className="text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

function ToggleField({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3">
      <input
        type="checkbox"
        className="mt-1"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <span className="text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-slate-400">{hint}</span>}
      </span>
    </label>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-slate-100 pb-1">
      <dt className="text-slate-600">{k}</dt>
      <dd className="font-medium tabular-nums text-slate-900">{v}</dd>
    </div>
  );
}
