"use client";

import { useState } from "react";
import Link from "next/link";
import { COMPLIMENTARY_TIER, PLANS, TIER_ORDER, Tier, applyLicence, clearLicence, isComplimentary } from "@/lib/subscription";
import { useTier } from "@/components/Gate";

export default function Pricing() {
  const tier = useTier();
  const [licence, setLicence] = useState("");
  const [msg, setMsg] = useState("");

  function redeem() {
    const granted = applyLicence(licence);
    setMsg(
      granted
        ? `Unlocked ${granted === "investor" ? "Investor" : "Buyer Pro"}. Enjoy.`
        : "That key doesn't look right — the format is HS-PRO-XXXX.",
    );
  }

  return (
    <div className="space-y-8">
      <header className="text-center">
        <h1 className="text-3xl font-bold">Plans</h1>
        <p className="mx-auto mt-2 max-w-2xl text-slate-600">
          {COMPLIMENTARY_TIER === "free"
            ? "The free plan tells you what's on the market. The paid plans tell you what it's worth, what to offer, and which listings are genuinely underpriced"
            : "Scout tells you what's on the market. Buyer Pro tells you what it's worth, what to offer, and which listings are genuinely underpriced"}{" "}
          — all computed by HouseScout&apos;s own valuation model, in your browser.
        </p>
        {COMPLIMENTARY_TIER === "pro" && (
          <p className="mx-auto mt-4 max-w-2xl rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900">
            🎉 Buyer Pro is free for everyone right now — every feature below, no card, no sign-up.
          </p>
        )}
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        {PLANS.map((plan) => {
          const current = tier === plan.tier;
          const featured = plan.tier === "pro";
          const free = isComplimentary(plan.tier);
          return (
            <section
              key={plan.tier}
              className={`card flex flex-col p-5 ${
                featured ? "border-brand ring-1 ring-brand" : ""
              }`}
            >
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold">{plan.name}</h2>
                {featured && (
                  <span className="badge bg-brand text-white">
                    {free && plan.priceMonthly > 0 ? "Free right now" : "Most popular"}
                  </span>
                )}
                {current && !featured && <span className="badge bg-slate-200">Current</span>}
              </div>
              <p className="mt-1 text-sm text-slate-500">{plan.tagline}</p>
              <p className="mt-4">
                <span className="text-3xl font-bold">
                  {plan.priceMonthly === 0 || free ? "Free" : `$${plan.priceMonthly}`}
                </span>
                {plan.priceMonthly > 0 && free && (
                  <span className="ml-2 text-sm text-slate-400 line-through">${plan.priceMonthly}/month</span>
                )}
                {plan.priceMonthly > 0 && !free && <span className="text-sm text-slate-500">/month</span>}
              </p>
              <ul className="mt-4 flex-1 space-y-2 text-sm">
                {plan.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <span aria-hidden className="text-brand">
                      ✓
                    </span>
                    <span className="text-slate-700">{f}</span>
                  </li>
                ))}
              </ul>
              <PlanButton plan={plan.tier} current={current} included={free} label={plan.cta} />
            </section>
          );
        })}
      </div>

      <section className="card p-5">
        <h2 className="font-semibold">Already have a key?</h2>
        <p className="mt-1 text-sm text-slate-600">
          Paste the licence key from your receipt to unlock your plan on this device.
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
            Redeem
          </button>
          {tier != null && TIER_ORDER[tier] > TIER_ORDER[COMPLIMENTARY_TIER] && (
            <button className="btn-ghost" onClick={() => { clearLicence(); setMsg("Reverted to the free plan."); }}>
              Switch to free
            </button>
          )}
        </div>
        {msg && <p className="mt-2 text-sm text-slate-600">{msg}</p>}
      </section>

      {/* Being straight with the user about what this is. Trust is the product. */}
      <section className="card border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
        <h2 className="font-semibold">Honest status: billing is not live yet</h2>
        <p className="mt-2">
          HouseScout is a static site, so there is no payment processor connected and no server
          checking your plan — the buttons above unlock features locally on this device so the
          experience can be built and tested end to end. Nothing is charged, and nothing is
          transmitted.
        </p>
        <p className="mt-2">
          Before real subscriptions open, entitlement has to move server-side (checkout, webhook,
          and serving the paid analysis from an authenticated endpoint rather than the public data
          file). Until then, please treat every figure as indicative and read the{" "}
          <Link href="/disclaimer" className="underline">
            disclaimer
          </Link>
          .
        </p>
      </section>
    </div>
  );
}

function PlanButton({
  plan,
  current,
  included,
  label,
}: {
  plan: Tier;
  current: boolean;
  included: boolean;
  label: string;
}) {
  const [done, setDone] = useState(false);

  // Free for everyone: nothing to buy and nothing to switch away from, so the buttons
  // would either do nothing or promise a downgrade that the baseline tier overrides.
  if (included) {
    return (
      <button className="btn-ghost mt-4 w-full" disabled>
        {plan === "free" ? "Included" : "Included — free for everyone"}
      </button>
    );
  }
  if (current) {
    return (
      <button className="btn-ghost mt-4 w-full" disabled>
        Current plan
      </button>
    );
  }
  if (plan === "free") {
    return (
      <button
        className="btn-ghost mt-4 w-full"
        onClick={() => {
          clearLicence();
          setDone(true);
        }}
      >
        {done ? "Switched" : "Switch to free"}
      </button>
    );
  }
  return (
    <button
      className="btn mt-4 w-full"
      onClick={() => {
        // Stands in for a checkout redirect until a payment provider is connected.
        applyLicence(`HS-${plan.toUpperCase()}-TRIAL`);
        setDone(true);
      }}
    >
      {done ? "Unlocked ✓" : label}
    </button>
  );
}
