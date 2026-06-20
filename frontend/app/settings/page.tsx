"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export default function Settings() {
  const [defaults, setDefaults] = useState<any>(null);
  const [ai, setAi] = useState<any>(null);
  const [scraping, setScraping] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    api.financeDefaults().then(setDefaults);
    api.aiHealth().then(setAi).catch(() => setAi({ available: false }));
  }, []);

  async function scrape(dry: boolean) {
    setScraping(true);
    setMsg("");
    try {
      const r = await fetch(`/api/scrape?dry_run=${dry}`, { method: "POST" }).then((x) => x.json());
      setMsg(r.started ? `Scrape started (dry_run=${dry}). Check backend logs.` : JSON.stringify(r));
    } catch (e) {
      setMsg(String(e));
    } finally {
      setScraping(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      <section className="card p-4">
        <h2 className="mb-2 font-semibold">Buyer profile &amp; defaults</h2>
        <p className="text-sm text-slate-500">Edit these in your <code>.env</code> file, then restart the backend.</p>
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
        <h2 className="mb-2 font-semibold">Local AI (LM Studio)</h2>
        <p className="text-sm">
          Status:{" "}
          <span className={ai?.available ? "font-semibold text-emerald-700" : "text-slate-500"}>
            {ai ? (ai.available ? "Online" : "Offline") : "…"}
          </span>
        </p>
        {ai?.models?.length ? (
          <p className="mt-1 text-xs text-slate-500">Loaded: {ai.models.join(", ")}</p>
        ) : (
          <p className="mt-1 text-xs text-slate-500">Start LM Studio, load a Gemma model, enable the local server on port 1234.</p>
        )}
      </section>

      <section className="card p-4">
        <h2 className="mb-2 font-semibold">Data refresh</h2>
        <p className="text-sm text-slate-500">
          Scraping needs Playwright installed and (for land area) a free LINZ API key in <code>.env</code>. Runs automatically on a schedule too.
        </p>
        <div className="mt-3 flex gap-2">
          <button className="btn-ghost" disabled={scraping} onClick={() => scrape(true)}>Test scrape (dry run)</button>
          <button className="btn" disabled={scraping} onClick={() => scrape(false)}>Scrape &amp; save</button>
        </div>
        {msg && <p className="mt-2 text-sm text-slate-600">{msg}</p>}
      </section>
    </div>
  );
}
