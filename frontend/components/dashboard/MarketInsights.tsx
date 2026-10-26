"use client";

import { Band, SALE_LABEL, SaleMethod, SuburbRow } from "@/lib/dashboard";
import { INK, SERIES, compactMoney, money } from "@/lib/viz";
import { TableView } from "@/components/viz/Primitives";

function Panel({ title, lead, children }: { title: string; lead: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="card p-4 md:p-5">
      <h2 className="font-bold tracking-tight">{title}</h2>
      <p className="mt-0.5 text-sm text-slate-600">{lead}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

// --------------------------------------------------------------------------- //
// Price bands vs the buyer's budget
// --------------------------------------------------------------------------- //
const FIT_COLOUR = { within: SERIES[0], stretch: SERIES[3], over: INK.quiet } as const;
const FIT_LABEL = { within: "Within budget", stretch: "Straddles your budget", over: "Over budget" } as const;

export function PriceBands({ bands, budget, total }: { bands: Band[]; budget: number; total: number }) {
  const max = Math.max(1, ...bands.map((b) => b.count));
  const within = bands.filter((b) => b.fit === "within").reduce((s, b) => s + b.count, 0);
  const stretch = bands.filter((b) => b.fit === "stretch").reduce((s, b) => s + b.count, 0);
  return (
    <Panel
      title="Where prices sit"
      lead={
        <>
          <strong className="text-slate-900">{within}</strong> of {total} homes are under{" "}
          {compactMoney(budget)}
          {stretch > 0 && <> — and {stretch} more straddle it</>}.
        </>
      }
    >
      <ul className="space-y-1.5" aria-label="Homes by price band">
        {bands.map((b) => (
          <li key={b.label} className="grid grid-cols-[5.5rem_1fr_2rem] items-center gap-2 text-sm">
            <span className="text-slate-600 tabular-nums">{b.label}</span>
            <span className="h-5 overflow-hidden rounded-md bg-slate-50">
              <span
                className="block h-full rounded-md transition-[width] duration-500"
                style={{ width: `${(b.count / max) * 100}%`, background: FIT_COLOUR[b.fit], minWidth: b.count ? 4 : 0 }}
              />
            </span>
            <span className="text-right font-semibold tabular-nums">{b.count}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
        {(Object.keys(FIT_COLOUR) as (keyof typeof FIT_COLOUR)[]).map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: FIT_COLOUR[k] }} aria-hidden />
            {FIT_LABEL[k]}
          </span>
        ))}
      </div>
      <TableView caption="Homes by price band" rows={bands.map((b) => ({ label: b.label, value: String(b.count) }))} />
    </Panel>
  );
}

// --------------------------------------------------------------------------- //
// How houses are being sold
// --------------------------------------------------------------------------- //
const METHOD_ORDER: SaleMethod[] = ["published", "auction", "deadline", "negotiation"];
const METHOD_COLOUR: Record<SaleMethod, string> = {
  published: SERIES[0],
  auction: SERIES[1],
  deadline: SERIES[2],
  negotiation: INK.muted,
};
const METHOD_HINT: Record<SaleMethod, string> = {
  published: "an asking price you can trust",
  auction: "no price until the hammer falls",
  deadline: "offers by a set date",
  negotiation: "ask the agent",
};

export function SaleMethods({ counts, total }: { counts: Record<SaleMethod, number>; total: number }) {
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  const unpublished = total - counts.published;
  return (
    <Panel
      title="How homes are being sold"
      lead={
        <>
          Only <strong className="text-slate-900">{pct(counts.published)}%</strong> publish a price. For the other{" "}
          {pct(unpublished)}%, the figure you see with a <span className="font-mono">~</span> is HouseScout&apos;s estimate.
        </>
      }
    >
      <div className="flex h-4 gap-0.5 overflow-hidden rounded-full" role="img" aria-label="Share of homes by sale method">
        {METHOD_ORDER.map((m) =>
          counts[m] ? <span key={m} style={{ width: `${(counts[m] / total) * 100}%`, background: METHOD_COLOUR[m] }} /> : null,
        )}
      </div>
      <ul className="mt-4 space-y-2.5">
        {METHOD_ORDER.map((m) => (
          <li key={m} className="flex items-center gap-3 text-sm">
            <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: METHOD_COLOUR[m] }} aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="font-medium">{SALE_LABEL[m]}</span>
              <span className="block truncate text-xs text-slate-500">{METHOD_HINT[m]}</span>
            </span>
            <span className="text-right">
              <span className="font-semibold tabular-nums">{counts[m]}</span>
              <span className="block text-xs text-slate-500 tabular-nums">{pct(counts[m])}%</span>
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// --------------------------------------------------------------------------- //
// Where the value is, by suburb
// --------------------------------------------------------------------------- //
export function SuburbValue({ rows }: { rows: SuburbRow[] }) {
  const top = rows.slice(0, 6);
  if (top.length === 0) return null;
  const hi = Math.max(...top.map((r) => r.avgDeal));
  const lo = Math.min(...top.map((r) => r.avgDeal));
  const scale = (v: number) => 35 + ((v - lo) / Math.max(hi - lo, 1)) * 65; // keep the smallest bar visible
  return (
    <Panel
      title="Where the value is"
      lead="Suburbs ranked by the average deal score of what's for sale there. Needs three or more homes to count."
    >
      <ol className="space-y-3">
        {top.map((r, i) => (
          <li key={r.suburb}>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="min-w-0 truncate">
                <span className="mr-1.5 text-slate-400 tabular-nums">{i + 1}</span>
                <Linkish>{r.suburb}</Linkish>
              </span>
              <span className="shrink-0 text-xs text-slate-500">
                {r.count} homes · median {compactMoney(r.medianPrice)} · {r.avgYield.toFixed(1)}% yield
              </span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full" style={{ width: `${scale(r.avgDeal)}%`, background: SERIES[0] }} />
            </div>
          </li>
        ))}
      </ol>
      <TableView
        caption="Average deal score by suburb"
        rows={top.map((r) => ({ label: r.suburb, value: `${Math.round(r.avgDeal)}/100 · ${r.count} homes · ${money(r.medianPrice)}` }))}
      />
    </Panel>
  );
}

function Linkish({ children }: { children: React.ReactNode }) {
  return <span className="font-medium text-slate-900">{children}</span>;
}
