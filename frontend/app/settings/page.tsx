"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import * as ai from "@/lib/ai";

export default function Settings() {
  const [defaults, setDefaults] = useState<any>(null);
  const [health, setHealth] = useState<any>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    api.financeDefaults().then(setDefaults);
    setBaseUrl(ai.getBaseUrl());
    setModel(ai.getChatModelOverride());
    api.aiHealth().then(setHealth).catch(() => setHealth({ available: false }));
  }, []);

  async function testConnection() {
    ai.setBaseUrl(baseUrl);
    ai.setChatModelOverride(model);
    setMsg("Checking endpoint…");
    const h = await ai.health();
    setHealth(h);
    setMsg(
      h.available
        ? `Connected. Models: ${h.models.join(", ") || "(none loaded)"}`
        : `Couldn't reach ${ai.getBaseUrl()} — ${h.error}`,
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      <section className="card p-4">
        <h2 className="mb-2 font-semibold">About this build</h2>
        <p className="text-sm text-slate-600">
          This is the static (GitHub Pages) build of HouseScout. Listings are real Christchurch
          properties scraped from realestate.co.nz automatically when the site builds (refreshed
          daily); scoring and all financial analysis then run entirely in your browser. For LINZ
          land enrichment and a persistent database, run the optional Python backend (see README).
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
        <h2 className="mb-2 font-semibold">Local AI (LM Studio)</h2>
        <p className="text-sm text-slate-600">
          The AI features call an OpenAI-compatible endpoint directly from your browser. Run
          LM Studio with a Gemma model and its local server enabled, then point the endpoint here.
          Nothing is sent anywhere else.
        </p>
        <p className="mt-2 text-sm">
          Status:{" "}
          <span className={health?.available ? "font-semibold text-emerald-700" : "text-slate-500"}>
            {health ? (health.available ? "Online" : "Offline") : "…"}
          </span>
        </p>
        {health?.models?.length ? (
          <p className="mt-1 text-xs text-slate-500">Loaded: {health.models.join(", ")}</p>
        ) : null}

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium text-slate-500">Endpoint base URL</span>
            <input
              className="input mt-1"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="http://localhost:1234/v1"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-500">Chat model (optional override)</span>
            <input
              className="input mt-1"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="auto (first loaded model)"
            />
          </label>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button className="btn" onClick={testConnection}>Save &amp; test connection</button>
          {msg && <span className="text-xs text-slate-500">{msg}</span>}
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Tip: a site served over HTTPS can still reach <code>http://localhost</code> (browsers treat
          localhost as trusted). Enable CORS in LM Studio if requests are blocked.
        </p>
      </section>
    </div>
  );
}
