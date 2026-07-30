"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Model, loadModel } from "@/lib/predict";
import { PLANS, applyLicence, clearLicence, getLicence, planFor } from "@/lib/subscription";
import { useTier } from "@/components/Gate";

export default function Settings() {
  const [defaults, setDefaults] = useState<any>(null);
  const [model, setModel] = useState<Model | null>(null);
  const [licence, setLicence] = useState("");
  const [msg, setMsg] = useState("");
  const tier = useTier();

  useEffect(() => {
    api.financeDefaults().then(setDefaults);
    loadModel().then(setModel);
    setLicence(getLicence());
  }, []);

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
            className="input max-w-xs"
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
          Confidence is low while few listings publish an asking price — most Christchurch stock
          under $500k sells by auction or deadline sale. The model shrinks toward documented
          valuation relationships rather than overfitting a small sample, and says so rather than
          presenting a false precision.
        </p>
      </section>

      <section className="card p-4">
        <h2 className="mb-2 font-semibold">Buyer profile &amp; defaults</h2>
        <p className="text-sm text-slate-500">
          These power the planner and per-listing finance. To change them permanently, edit
          <code className="mx-1 rounded bg-slate-100 px-1">frontend/lib/data.ts</code> and redeploy.
        </p>
        {defaults && (
          <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
{`MAX_PRICE=${defaults.max_price}
PREAPPROVAL=${defaults.preapproval}
DEPOSIT=${defaults.deposit}
DEFAULT_MORTGAGE_RATE=${defaults.annual_rate}
DEFAULT_TERM_YEARS=${defaults.term_years}
BOARDER_WEEKLY_RENT=${defaults.weekly_rent}`}
          </pre>
        )}
      </section>

      <section className="card p-4">
        <h2 className="mb-2 font-semibold">About this build</h2>
        <p className="text-sm text-slate-600">
          This is the static build of HouseScout. Listings are scraped from public Christchurch
          property sources when the site builds, with photos downloaded and self-hosted; scoring,
          valuation and all financial analysis then run entirely in your browser. Where a listing
          publishes no price, HouseScout&apos;s estimate is shown and labelled as such. For LINZ
          land enrichment and a persistent database, run the optional Python backend (see README).
        </p>
      </section>
    </div>
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
