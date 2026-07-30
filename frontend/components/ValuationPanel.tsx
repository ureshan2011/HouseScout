"use client";

import { useEffect, useState } from "react";
import { Listing, fmt } from "@/lib/api";
import { Model, Prediction, loadModel, predict } from "@/lib/predict";
import { Gate, BlurredTeaser, UpgradePrompt } from "@/components/Gate";

// Surfaces the prediction engine (frontend/lib/predict.ts) on a listing.
//
// Every figure here is produced by the in-app model — no external service, no
// language model — and each one shows the reasoning that produced it. The
// confidence band and sample size are shown *prominently* rather than buried,
// because a valuation fitted on a handful of published prices must not read as
// a registered valuation.

export function useModel(): Model | null {
  const [model, setModel] = useState<Model | null>(null);
  useEffect(() => {
    loadModel().then(setModel);
  }, []);
  return model;
}

export function usePrediction(listing: Listing | null | undefined): Prediction | null {
  const model = useModel();
  const [p, setP] = useState<Prediction | null>(null);
  useEffect(() => {
    if (!model || !listing) return;
    setP(predict(listing, model));
  }, [model, listing]);
  return p;
}

const VERDICT_STYLE: Record<string, string> = {
  bargain: "bg-emerald-100 text-emerald-900",
  under: "bg-emerald-50 text-emerald-800",
  fair: "bg-slate-100 text-slate-700",
  over: "bg-amber-100 text-amber-900",
  steep: "bg-rose-100 text-rose-900",
};

const VERDICT_LABEL: Record<string, string> = {
  bargain: "Well below model",
  under: "Below model",
  fair: "Fairly priced",
  over: "Above model",
  steep: "Well above model",
};

const CONFIDENCE_NOTE: Record<string, string> = {
  low: "Low confidence — few published asking prices to calibrate against, so this leans on documented valuation relationships.",
  medium: "Medium confidence — calibrated on a modest sample of published asking prices.",
  high: "High confidence — calibrated on a substantial sample of published asking prices.",
};

function ConfidenceBadge({ p }: { p: Prediction }) {
  const level = p.valuation.confidence;
  const tone =
    level === "high" ? "bg-emerald-100 text-emerald-800"
    : level === "medium" ? "bg-amber-100 text-amber-800"
    : "bg-slate-200 text-slate-700";
  return <span className={`badge ${tone}`}>{level} confidence</span>;
}

/** Fair value, price position and the feature-by-feature explanation. */
function ValuationBody({ listing, p }: { listing: Listing; p: Prediction }) {
  const v = p.valuation;
  const pos = p.position;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Modelled value</p>
          <p className="text-3xl font-bold">{fmt.money(v.estimate)}</p>
          <p className="text-sm text-slate-500">
            range {fmt.money(v.low)} – {fmt.money(v.high)} (±{Math.round(v.band * 100)}%)
          </p>
        </div>
        <div className="text-right">
          <ConfidenceBadge p={p} />
          {pos && (
            <p className="mt-2">
              <span className={`badge ${VERDICT_STYLE[pos.verdict]}`}>
                {VERDICT_LABEL[pos.verdict]} {pos.deltaPct > 0 ? "+" : ""}
                {pos.deltaPct}%
              </span>
            </p>
          )}
        </div>
      </div>

      {!pos && (
        <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
          This listing publishes no asking price ({listing.price_text || "method not stated"}), so
          there is nothing to compare the model against — the {fmt.money(listing.price)} shown
          elsewhere is HouseScout&apos;s own estimate. Use the modelled value above as your
          reference and verify it against recent comparable sales.
        </p>
      )}

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          How the model got there
        </p>
        <p className="text-sm text-slate-600">
          Modelled value of a typical house in {listing.suburb || "this suburb"}:{" "}
          <strong>{fmt.money(v.baseline)}</strong>, then adjusted for this property:
        </p>
        <ul className="mt-2 space-y-1 text-sm">
          {v.contributions.slice(0, 6).map((c) => (
            <li key={c.feature} className="flex items-center justify-between gap-2">
              <span className="text-slate-600">{c.label}</span>
              <span
                className={`font-medium tabular-nums ${
                  c.effect >= 0 ? "text-emerald-700" : "text-rose-700"
                }`}
              >
                {c.effect >= 0 ? "+" : "−"}
                {fmt.money(Math.abs(c.effect))}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <p className="border-t border-slate-100 pt-3 text-xs text-slate-500">
        {CONFIDENCE_NOTE[v.confidence]} Calibrated on {v.n_train} published asking price
        {v.n_train === 1 ? "" : "s"}
        {v.cv_mae_pct != null ? `, cross-validated error ±${v.cv_mae_pct}%` : ""}. Indicative only —
        not a registered valuation.
      </p>
    </div>
  );
}

export function ValuationCard({ listing }: { listing: Listing }) {
  const p = usePrediction(listing);

  return (
    <section className="card p-4">
      <h2 className="mb-3 flex items-center gap-2 font-semibold">
        <span aria-hidden>📈</span> Valuation model
      </h2>
      {!p ? (
        <div className="h-40 animate-pulse rounded-lg bg-slate-100" />
      ) : (
        <Gate
          feature="valuation"
          title="Modelled fair value"
          blurb="See what this property is actually worth, how its asking price compares, and exactly which features drive the number."
          fallback={
            <div className="space-y-3">
              <BlurredTeaser>
                <ValuationBody listing={listing} p={p} />
              </BlurredTeaser>
              <UpgradePrompt
                feature="valuation"
                title="Modelled fair value"
                blurb="See what this property is worth, whether it is over- or under-priced, and which features drive the number."
              />
            </div>
          }
        >
          <ValuationBody listing={listing} p={p} />
        </Gate>
      )}
    </section>
  );
}

/** Negotiation room, target offer and the reasoning behind it. */
export function NegotiationCard({ listing }: { listing: Listing }) {
  const p = usePrediction(listing);
  if (!p) return null;
  const n = p.negotiation;

  return (
    <section className="card p-4">
      <h2 className="mb-3 flex items-center gap-2 font-semibold">
        <span aria-hidden>🤝</span> Negotiation
      </h2>
      <Gate
        feature="negotiation"
        title="Negotiation room & target offer"
        blurb="How much room this sale method and listing age typically leave, and the offer to open at."
      >
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <p className="text-xs uppercase text-slate-500">Method</p>
              <p className="font-medium">{n.method}</p>
            </div>
            {n.targetOffer != null ? (
              <>
                <div>
                  <p className="text-xs uppercase text-slate-500">Expected room</p>
                  <p className="font-medium">{n.expectedPct}%</p>
                </div>
                <div>
                  <p className="text-xs uppercase text-slate-500">Open at</p>
                  <p className="font-semibold text-brand-dark">{fmt.money(n.targetOffer)}</p>
                  <p className="text-[10px] text-slate-400">
                    off the published {fmt.money(listing.price)}
                  </p>
                </div>
              </>
            ) : (
              <div className="sm:col-span-2">
                <p className="text-xs uppercase text-slate-500">Your ceiling</p>
                <p className="font-semibold text-brand-dark">{fmt.money(n.ceiling)}</p>
                <p className="text-[10px] text-slate-400">
                  modelled value — with no published price, this is the number to hold to
                </p>
              </div>
            )}
          </div>
          <ul className="space-y-1 text-sm text-slate-600">
            {n.drivers.map((d) => (
              <li key={d} className="flex gap-2">
                <span aria-hidden className="text-slate-400">
                  •
                </span>
                {d}
              </li>
            ))}
          </ul>
          <p className="text-xs text-slate-500">
            Derived from sale method, days on market and price versus the model. A guide for
            framing an offer, not a prediction of the vendor&apos;s reserve.
          </p>
        </div>
      </Gate>
    </section>
  );
}

/** Ten-year capital growth projection with a widening uncertainty band. */
export function ForecastCard({ listing }: { listing: Listing }) {
  const p = usePrediction(listing);
  if (!p) return null;
  const g = p.growth;
  const max = Math.max(...g.points.map((pt) => pt.high));

  return (
    <section className="card p-4">
      <h2 className="mb-3 flex items-center gap-2 font-semibold">
        <span aria-hidden>🔮</span> Capital growth forecast
      </h2>
      <Gate
        feature="growthForecast"
        title="10-year growth forecast"
        blurb="Projected value with an honest uncertainty band, using suburb growth that reverts toward the city average."
      >
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <p className="text-xs uppercase text-slate-500">Year 1 rate</p>
              <p className="font-medium">{g.year1Pct}%</p>
            </div>
            <div>
              <p className="text-xs uppercase text-slate-500">Value in 5 yrs</p>
              <p className="font-medium">{fmt.money(g.valueIn5)}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-slate-500">Value in 10 yrs</p>
              <p className="font-semibold text-brand-dark">{fmt.money(g.valueIn10)}</p>
            </div>
          </div>

          {/* Compact inline band chart — no charting library needed.
              Each column is h-full so the percentage heights below resolve against
              the fixed 6rem track rather than collapsing to zero. */}
          <div className="flex h-24 items-end gap-1" role="img" aria-label="Projected value by year">
            {g.points.map((pt) => (
              <div key={pt.year} className="flex h-full flex-1 flex-col justify-end">
                <div
                  className="w-full rounded-t bg-brand/25"
                  style={{ height: `${((pt.high - pt.value) / max) * 100}%` }}
                  title={`Year ${pt.year}: ${fmt.money(pt.low)} – ${fmt.money(pt.high)}`}
                />
                <div
                  className="w-full bg-brand"
                  style={{ height: `${(pt.value / max) * 100}%` }}
                  title={`Year ${pt.year}: ${fmt.money(pt.value)}`}
                />
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-500">
            Suburb growth blended toward the {g.anchorPct}%/yr city anchor, because a suburb running
            hot or cold reverts rather than compounding forever. The band widens with the square
            root of time. Projections, not promises.
          </p>
        </div>
      </Gate>
    </section>
  );
}

/** Predicted rent, per room and whole-house. */
export function RentCard({ listing }: { listing: Listing }) {
  const p = usePrediction(listing);
  if (!p) return null;
  const r = p.rent;
  return (
    <section className="card p-4">
      <h2 className="mb-3 flex items-center gap-2 font-semibold">
        <span aria-hidden>🛏️</span> Predicted rent
      </h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <p className="text-xs uppercase text-slate-500">Per room / week</p>
          <p className="text-xl font-semibold">${r.perRoomWeekly}</p>
        </div>
        <div>
          <p className="text-xs uppercase text-slate-500">Whole house / week</p>
          <p className="text-xl font-semibold">${r.wholeHouseWeekly}</p>
        </div>
        <div>
          <p className="text-xs uppercase text-slate-500">Gross yield</p>
          <p className="text-xl font-semibold">{r.yieldPct}%</p>
        </div>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        From {listing.suburb || "the suburb"}&apos;s {r.suburbYieldPct}% reference yield. Letting
        room-by-room beats a whole-house tenancy per dollar of house, which is why the per-room
        figure sits above a simple divide-by-bedrooms.
      </p>
    </section>
  );
}

/** Compact deal grade for use on cards and in lists. */
export function DealBadge({ listing }: { listing: Listing }) {
  const p = usePrediction(listing);
  if (!p) return null;
  const { grade, score } = p.deal;
  const tone =
    grade === "A" ? "bg-emerald-600 text-white"
    : grade === "B" ? "bg-teal-600 text-white"
    : grade === "C" ? "bg-amber-500 text-white"
    : "bg-slate-400 text-white";
  return (
    <span className={`badge ${tone}`} title={p.deal.reasons.join(" · ")}>
      Deal {grade} ({score}){p.deal.fundamentalsOnly ? "*" : ""}
    </span>
  );
}
