"use client";

import { useEffect, useState } from "react";
import { api, Finance, fmt } from "@/lib/api";
import { PayoffChart } from "@/components/PayoffChart";

export default function Planner() {
  const [f, setF] = useState({
    price: 449000, deposit: 50000, annual_rate: 0.0519, term_years: 30,
    bedrooms: 3, weekly_rent: 220, occupancy: 1.0, reinvest_boarder_income: true,
  });
  const [res, setRes] = useState<Finance | null>(null);

  useEffect(() => {
    api.financeDefaults().then((d) =>
      setF((s) => ({ ...s, deposit: d.deposit, annual_rate: d.annual_rate, term_years: d.term_years, weekly_rent: d.weekly_rent }))
    );
  }, []);

  useEffect(() => {
    const t = setTimeout(() => api.scenario(f).then(setRes).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [f]);

  const set = (k: string, v: any) => setF((s) => ({ ...s, [k]: v }));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Financial planner</h1>
        <p className="text-sm text-slate-500">Model any purchase + boarder strategy. IRD: up to $245/wk per boarder (max 4) is tax-free.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <div className="card space-y-3 p-4">
          <Num label="Purchase price" value={f.price} onChange={(v) => set("price", v)} step={5000} />
          <Num label="Deposit" value={f.deposit} onChange={(v) => set("deposit", v)} step={5000} />
          <Range label={`Interest rate: ${(f.annual_rate * 100).toFixed(2)}%`} min={0.03} max={0.09} step={0.0005} value={f.annual_rate} onChange={(v) => set("annual_rate", v)} />
          <Range label={`Term: ${f.term_years} yr`} min={10} max={30} step={1} value={f.term_years} onChange={(v) => set("term_years", v)} />
          <Num label="Bedrooms" value={f.bedrooms} onChange={(v) => set("bedrooms", v)} step={1} />
          <Num label="Weekly rent / room" value={f.weekly_rent} onChange={(v) => set("weekly_rent", v)} step={10} />
          <Range label={`Occupancy: ${Math.round(f.occupancy * 100)}%`} min={0.5} max={1} step={0.05} value={f.occupancy} onChange={(v) => set("occupancy", v)} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.reinvest_boarder_income} onChange={(e) => set("reinvest_boarder_income", e.target.checked)} />
            Reinvest room income into extra repayments
          </label>
        </div>

        <div className="space-y-4">
          {res && (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <KPI label="Loan" value={fmt.money(res.loan)} />
                <KPI label="Monthly P&I" value={fmt.money(res.monthly_payment)} />
                <KPI label="Rooms to rent" value={String(res.boarder.rentable_rooms)} />
                <KPI label="Room income / mo" value={fmt.money(res.monthly_boarder_income)} />
                <KPI label="Tax-free / wk" value={fmt.money(res.boarder.weekly_tax_free)} />
                <KPI label="Net out-of-pocket / mo" value={fmt.money(res.net_monthly_outlay)} accent={res.net_monthly_outlay <= 0} />
                <KPI label="Gross yield" value={fmt.pct(res.gross_yield_pct)} />
                <KPI label="Payoff (standard)" value={`${res.standard.payoff_years ?? "—"} yr`} />
                <KPI label="Payoff (room rent)" value={`${res.accelerated.payoff_years ?? "—"} yr`} accent />
              </div>
              {res.years_saved != null && (
                <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
                  Mortgage-free <strong>{res.years_saved} years sooner</strong>, saving{" "}
                  <strong>{fmt.money(res.interest_saved)}</strong> in interest.
                </p>
              )}
              <div className="card p-4">
                <PayoffChart standard={res.standard.yearly_balance} accelerated={res.accelerated.yearly_balance} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Num({ label, value, onChange, step }: { label: string; value: number; onChange: (v: number) => void; step: number }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <input className="input mt-1" type="number" step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function Range({ label, value, onChange, min, max, step }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step: number }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <input className="mt-1 w-full" type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function KPI({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`card p-3 ${accent ? "bg-emerald-50" : ""}`}>
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`text-lg font-bold ${accent ? "text-emerald-700" : ""}`}>{value}</p>
    </div>
  );
}
