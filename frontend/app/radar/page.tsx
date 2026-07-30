"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, Listing, fmt } from "@/lib/api";
import { Model, Prediction, loadModel, predict } from "@/lib/predict";
import { Gate, BlurredTeaser, UpgradePrompt } from "@/components/Gate";
import { toCsv, downloadCsv } from "@/lib/exportCsv";
import { useFeature } from "@/components/Gate";

// Deal Radar — the market ranked by opportunity rather than by fit.
//
// The Listings page answers "does this match my brief?". This answers the question a
// buyer actually pays for: "out of everything on the market right now, where is the
// value?" It runs the valuation model over every listing, sorts by the composite
// deal score, and shows the gap between asking price and modelled value.

type Row = { listing: Listing; prediction: Prediction };

export default function Radar() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [model, setModel] = useState<Model | null>(null);
  const [minGrade, setMinGrade] = useState("C");
  const [onlyUnderpriced, setOnlyUnderpriced] = useState(false);
  const csv = useFeature("csvExport");

  useEffect(() => {
    Promise.all([api.listings("?passes_only=false&limit=200"), loadModel()]).then(([ls, m]) => {
      setModel(m);
      setRows(ls.map((listing) => ({ listing, prediction: predict(listing, m) })));
    });
  }, []);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const floor = { A: 75, B: 60, C: 45, D: 0 }[minGrade] ?? 0;
    return rows
      .filter((r) => r.prediction.deal.score >= floor)
      // "Below modelled value" is only answerable for listings that published a
      // price, so this filter excludes the rest rather than assuming a gap of 0.
      .filter((r) => !onlyUnderpriced || (r.prediction.position?.deltaPct ?? 1) < 0)
      .sort((a, b) => b.prediction.deal.score - a.prediction.deal.score);
  }, [rows, minGrade, onlyUnderpriced]);

  function exportCsv() {
    downloadCsv(
      "housescout-deal-radar.csv",
      toCsv(
        filtered.map(({ listing: l, prediction: p }) => ({
          address: l.address ?? "",
          suburb: l.suburb ?? "",
          price: l.price ?? "",
          price_basis: l.data_quality === "observed" ? "listed" : "estimated",
          modelled_value: p.valuation.estimate,
          delta_pct: p.position?.deltaPct ?? "",
          deal_grade: p.deal.grade,
          deal_score: p.deal.score,
          deal_basis: p.deal.fundamentalsOnly ? "fundamentals only" : "value + fundamentals",
          room_rent_weekly: p.rent.perRoomWeekly,
          gross_yield_pct: p.rent.yieldPct,
          target_offer: p.negotiation.targetOffer ?? "",
          ceiling: p.negotiation.ceiling,
          value_in_10yr: p.growth.valueIn10,
          url: l.url ?? "",
        })),
      ),
    );
  }

  const preview = (rows ?? []).slice(0, 3);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Deal Radar</h1>
        <p className="text-sm text-slate-600">
          Every listing scored on value against the model, income potential, growth outlook and land
          — ranked by opportunity, not by how well it matches your filters.
        </p>
      </header>

      <Gate
        feature="dealRadar"
        title="Deal Radar"
        blurb="Rank the whole market by opportunity: which listings are underpriced against the model, and by how much."
        fallback={
          <div className="space-y-3">
            <BlurredTeaser>
              <RadarTable rows={preview} />
            </BlurredTeaser>
            <UpgradePrompt
              feature="dealRadar"
              title="Deal Radar"
              blurb="See every listing ranked by value against the model, with the gap to modelled value and a target offer for each."
            />
          </div>
        }
      >
        <div className="card flex flex-wrap items-end gap-3 p-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-500">Minimum grade</span>
            <select className="input" value={minGrade} onChange={(e) => setMinGrade(e.target.value)}>
              <option value="A">A only</option>
              <option value="B">B and above</option>
              <option value="C">C and above</option>
              <option value="D">Everything</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={onlyUnderpriced}
              onChange={(e) => setOnlyUnderpriced(e.target.checked)}
            />
            Below modelled value only (published prices)
          </label>
          {csv.allowed && (
            <button className="btn-ghost" onClick={exportCsv} disabled={!filtered.length}>
              ⬇ Export CSV
            </button>
          )}
        </div>

        {rows == null ? (
          <p className="text-sm text-slate-500">Scoring the market…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing clears that bar right now — try a lower grade.</p>
        ) : (
          <>
            <p className="text-xs text-slate-500">
              {filtered.length} listings · model calibrated on {model?.n_train ?? 0} published asking
              price{model?.n_train === 1 ? "" : "s"} ({model?.confidence} confidence). Figures are
              indicative, not valuations. Grades marked <strong>*</strong> are scored on
              fundamentals only — those listings publish no price, so there is no value gap to
              measure.
            </p>
            <RadarTable rows={filtered} />
          </>
        )}
      </Gate>
    </div>
  );
}

const GRADE_TONE: Record<string, string> = {
  A: "bg-emerald-600 text-white",
  B: "bg-teal-600 text-white",
  C: "bg-amber-500 text-white",
  D: "bg-slate-400 text-white",
};

function RadarTable({ rows }: { rows: Row[] }) {
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="p-3">Deal</th>
            <th className="p-3">Property</th>
            <th className="p-3 text-right">Price</th>
            <th className="p-3 text-right">Modelled</th>
            <th className="p-3 text-right">Gap</th>
            <th className="p-3 text-right">Room rent</th>
            <th className="p-3 text-right">Open at / ceiling</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ listing: l, prediction: p }) => (
            <tr key={l.id} className="border-t border-slate-100 hover:bg-slate-50">
              <td className="p-3">
                <span
                  className={`badge ${GRADE_TONE[p.deal.grade]}`}
                  title={p.deal.reasons.join(" · ")}
                >
                  {p.deal.grade} {p.deal.score}
                  {p.deal.fundamentalsOnly ? "*" : ""}
                </span>
              </td>
              <td className="p-3">
                <Link href={`/listings/${l.id}`} className="font-medium hover:underline">
                  {l.address}
                </Link>
                <p className="text-xs text-slate-500">
                  {l.suburb} · {l.bedrooms ?? "?"} bd · {p.deal.reasons[0]}
                </p>
              </td>
              <td className="p-3 text-right tabular-nums">
                {fmt.money(l.price)}
                {l.data_quality !== "observed" && (
                  <span className="block text-[10px] text-amber-700">estimated</span>
                )}
              </td>
              <td className="p-3 text-right tabular-nums">{fmt.money(p.valuation.estimate)}</td>
              <td
                className={`p-3 text-right tabular-nums font-medium ${
                  (p.position?.deltaPct ?? 0) < 0 ? "text-emerald-700" : "text-slate-600"
                }`}
              >
                {p.position ? (
                  `${p.position.deltaPct > 0 ? "+" : ""}${p.position.deltaPct}%`
                ) : (
                  <span
                    className="font-normal text-slate-400"
                    title="No asking price published, so there is nothing to compare the model against."
                  >
                    no price
                  </span>
                )}
              </td>
              <td className="p-3 text-right tabular-nums">${p.rent.perRoomWeekly}/wk</td>
              <td className="p-3 text-right tabular-nums">
                {p.negotiation.targetOffer != null ? (
                  fmt.money(p.negotiation.targetOffer)
                ) : (
                  <span title="No published price to discount — this is the most it is worth paying.">
                    ≤ {fmt.money(p.negotiation.ceiling)}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
