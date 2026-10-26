"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { api, Facet, Listing } from "@/lib/api";
import { ListingCard } from "@/components/ListingCard";
import { UpgradePrompt, useFeature } from "@/components/Gate";
import { FREE_LISTING_LIMIT } from "@/lib/subscription";
import { useProfile } from "@/lib/useProfile";

// MapLibre touches `window`, so load it client-side only.
const ListingsMap = dynamic(() => import("@/components/ListingsMap").then((m) => m.ListingsMap), {
  ssr: false,
  loading: () => <p className="text-sm text-slate-500">Loading map…</p>,
});

// Every search criterion is a filter here rather than a build-time constant. The set
// is mirrored into the URL, so a search is shareable, bookmarkable and survives a
// reload — and the district/suburb/type menus are built from the data this build
// actually scraped, so they can never offer an empty option.
type Filters = {
  sort: string;
  q: string;
  regions: string[];
  suburbs: string[];
  types: string[];
  minPrice: string;
  maxPrice: string;
  minBeds: string;
  minBaths: string;
  minLand: string;
  garageOnly: boolean;
  pricedOnly: boolean;
  passesOnly: boolean;
};

const EMPTY: Filters = {
  sort: "score",
  q: "",
  regions: [],
  suburbs: [],
  types: [],
  minPrice: "",
  maxPrice: "",
  minBeds: "",
  minBaths: "",
  minLand: "",
  garageOnly: true,
  pricedOnly: false,
  passesOnly: true,
};

function fromUrl(): Filters {
  if (typeof window === "undefined") return EMPTY;
  const p = new URLSearchParams(window.location.search);
  const list = (k: string) => (p.get(k) ? p.get(k)!.split(",").filter(Boolean) : []);
  const bool = (k: string, fallback: boolean) =>
    p.get(k) == null ? fallback : p.get(k) === "true";
  return {
    sort: p.get("sort") || EMPTY.sort,
    q: p.get("q") || "",
    regions: list("region"),
    suburbs: list("suburb"),
    types: list("property_type"),
    minPrice: p.get("min_price") || "",
    maxPrice: p.get("max_price") || "",
    minBeds: p.get("min_bedrooms") || "",
    minBaths: p.get("min_bathrooms") || "",
    minLand: p.get("min_land") || "",
    garageOnly: bool("garage_only", EMPTY.garageOnly),
    pricedOnly: bool("priced_only", EMPTY.pricedOnly),
    passesOnly: bool("passes_only", EMPTY.passesOnly),
  };
}

/** Filters -> the query string consumed by lib/api.ts and written to the address bar. */
function toQuery(f: Filters): string {
  const p = new URLSearchParams();
  p.set("sort", f.sort);
  p.set("garage_only", String(f.garageOnly));
  p.set("passes_only", String(f.passesOnly));
  if (f.pricedOnly) p.set("priced_only", "true");
  if (f.q.trim()) p.set("q", f.q.trim());
  if (f.regions.length) p.set("region", f.regions.join(","));
  if (f.suburbs.length) p.set("suburb", f.suburbs.join(","));
  if (f.types.length) p.set("property_type", f.types.join(","));
  if (f.minPrice) p.set("min_price", f.minPrice);
  if (f.maxPrice) p.set("max_price", f.maxPrice);
  if (f.minBeds) p.set("min_bedrooms", f.minBeds);
  if (f.minBaths) p.set("min_bathrooms", f.minBaths);
  if (f.minLand) p.set("min_land", f.minLand);
  p.set("limit", "200");
  return p.toString();
}

/** How many criteria differ from the defaults — shown so an empty result is explicable. */
function activeCount(f: Filters): number {
  let n = 0;
  if (f.q.trim()) n++;
  n += f.regions.length ? 1 : 0;
  n += f.suburbs.length ? 1 : 0;
  n += f.types.length ? 1 : 0;
  for (const v of [f.minPrice, f.maxPrice, f.minBeds, f.minBaths, f.minLand]) if (v) n++;
  if (f.garageOnly !== EMPTY.garageOnly) n++;
  if (f.pricedOnly !== EMPTY.pricedOnly) n++;
  if (f.passesOnly !== EMPTY.passesOnly) n++;
  return n;
}

type Facets = { regions: Facet[]; suburbs: Facet[]; propertyTypes: Facet[] };

export default function ListingsPage() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [suburbFacets, setSuburbFacets] = useState<Facet[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [showAll, setShowAll] = useState(false);
  const [view, setView] = useState<"grid" | "map">("grid");
  // Phones show the filters as a bottom sheet rather than a card that pushes the
  // listings several screens down. Has no effect from `md` up.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const unlimited = useFeature("unlimitedListings");
  const profile = useProfile();

  // Free tier sees the best matches; the rest is behind the paywall. Capping the
  // *tail* rather than the head means the free plan is genuinely useful, which is
  // what makes the upgrade feel like more rather than an unblock.
  const capped = unlimited.allowed ? listings : listings.slice(0, FREE_LISTING_LIMIT);
  const hidden = listings.length - capped.length;

  const set = useCallback((patch: Partial<Filters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
  }, []);

  // Read the URL once on mount so a shared link lands on the same search. District and
  // property-type menus come from the whole dataset, so they never shrink out from
  // under a selection.
  useEffect(() => {
    setFilters(fromUrl());
    api.facets("?passes_only=false").then(setFacets);
  }, []);

  // Suburb chips are scoped to the selected districts — nationwide that is the
  // difference between a dozen chips and several hundred.
  useEffect(() => {
    const p = new URLSearchParams({ passes_only: "false" });
    if (filters.regions.length) p.set("region", filters.regions.join(","));
    api.facets(`?${p.toString()}`).then((f) => setSuburbFacets(f.suburbs));
    setShowAll(false);
  }, [filters.regions]);

  // Every filter change re-queries and rewrites the address bar. All of this runs in
  // the browser over an already-loaded array, so there is no request to debounce.
  //
  // The profile is a dependency too: budget, garage and backyard are hard filters and
  // the match score is computed from the same numbers, so editing them from anywhere
  // has to re-rank the page. Without this, raising your budget left the list unchanged.
  useEffect(() => {
    const qs = toQuery(filters);
    setLoading(true);
    api
      .listings(`?${qs}`)
      .then(setListings)
      .finally(() => setLoading(false));
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `${window.location.pathname}?${qs}`);
    }
  }, [filters, profile]);

  const active = useMemo(() => activeCount(filters), [filters]);

  useEffect(() => {
    if (!filtersOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFiltersOpen(false);
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [filtersOpen]);

  // Suburbs are long-tailed — 40+ in one district, hundreds nationwide — so the list
  // is trimmed until asked for.
  const suburbOptions = suburbFacets;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Listings</h1>
        <div className="flex overflow-hidden rounded-lg border border-slate-300 text-sm">
          <button
            className={`min-h-[2.75rem] px-4 md:min-h-0 md:px-3 md:py-1.5 ${view === "grid" ? "bg-brand text-white" : ""}`}
            onClick={() => setView("grid")}
            aria-pressed={view === "grid"}
          >
            Grid
          </button>
          <button
            className={`min-h-[2.75rem] px-4 md:min-h-0 md:px-3 md:py-1.5 ${view === "map" ? "bg-brand text-white" : ""}`}
            onClick={() => setView("map")}
            aria-pressed={view === "map"}
          >
            Map
          </button>
        </div>
      </div>

      {/* Phone search bar: search stays one tap away; everything else is in the sheet. */}
      <div className="sticky top-[calc(env(safe-area-inset-top)+3.75rem)] z-20 -mx-4 flex gap-2 bg-slate-50/95 px-4 py-2 backdrop-blur md:hidden">
        <input
          className="input min-w-0 flex-1"
          type="search"
          enterKeyHint="search"
          autoCapitalize="none"
          autoCorrect="off"
          value={filters.q}
          onChange={(e) => set({ q: e.target.value })}
          placeholder="Street, suburb or keyword"
          aria-label="Search listings"
        />
        <button
          type="button"
          onClick={() => setFiltersOpen(true)}
          aria-haspopup="dialog"
          className="btn-ghost press relative shrink-0 gap-1.5 bg-white"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M4 6h16M7 12h10M10 18h4" />
          </svg>
          Filters
          {active > 0 && (
            <span className="rounded-full bg-brand px-1.5 text-xs font-semibold leading-5 text-white">{active}</span>
          )}
        </button>
      </div>
      <p className="px-0.5 text-sm text-slate-500 md:hidden" aria-live="polite">
        {loading ? "Filtering…" : `${listings.length} match${listings.length === 1 ? "" : "es"}`}
      </p>

      <div
        className={
          filtersOpen
            ? "!mt-0 fixed inset-0 z-[60] flex flex-col justify-end md:!mt-4 md:static md:block"
            : "hidden md:block"
        }
        role={filtersOpen ? "dialog" : undefined}
        aria-modal={filtersOpen ? true : undefined}
        aria-label={filtersOpen ? "Filters" : undefined}
      >
        <button
          type="button"
          aria-label="Close filters"
          className="sheet-backdrop absolute inset-0 bg-slate-900/40 md:hidden"
          onClick={() => setFiltersOpen(false)}
        />
        <div className="card sheet relative max-h-[88dvh] space-y-4 overflow-y-auto rounded-b-none p-4 pb-0 md:max-h-none md:rounded-b-xl md:pb-4 md:[animation:none]">
        <div className="-mx-4 -mt-4 mb-1 flex items-center justify-between border-b border-slate-200 px-4 py-2 md:hidden">
          <h2 className="font-semibold">Filters</h2>
          <button
            type="button"
            onClick={() => setFiltersOpen(false)}
            aria-label="Close filters"
            className="press -mr-2 flex h-11 w-11 items-center justify-center rounded-full text-slate-400"
          >
            ✕
          </button>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Search" className="hidden min-w-[14rem] flex-1 md:flex">
            <input
              className="input w-full"
              value={filters.q}
              onChange={(e) => set({ q: e.target.value })}
              placeholder="Street, suburb or keyword"
              aria-label="Search listings"
            />
          </Field>
          <Field label="Sort" className="w-full md:w-auto">
            <select className="input w-full" value={filters.sort} onChange={(e) => set({ sort: e.target.value })}>
              <option value="score">Best match</option>
              <option value="price">Price (low → high)</option>
              <option value="price_desc">Price (high → low)</option>
              <option value="newest">Newest</option>
              <option value="land">Largest section</option>
              <option value="bedrooms">Most bedrooms</option>
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 items-end gap-3 md:flex md:flex-wrap">
          <Field label="Min price">
            <input
              className="input w-full md:w-32"
              inputMode="numeric"
              value={filters.minPrice}
              onChange={(e) => set({ minPrice: e.target.value })}
              placeholder="Any"
            />
          </Field>
          <Field label="Max price">
            <input
              className="input w-full md:w-32"
              inputMode="numeric"
              value={filters.maxPrice}
              onChange={(e) => set({ maxPrice: e.target.value })}
              placeholder="Any"
            />
          </Field>
          <Field label="Min beds">
            <input
              className="input w-full md:w-24"
              inputMode="numeric"
              value={filters.minBeds}
              onChange={(e) => set({ minBeds: e.target.value })}
              placeholder="Any"
            />
          </Field>
          <Field label="Min baths">
            <input
              className="input w-full md:w-24"
              inputMode="numeric"
              value={filters.minBaths}
              onChange={(e) => set({ minBaths: e.target.value })}
              placeholder="Any"
            />
          </Field>
          <Field label="Min land (m²)">
            <input
              className="input w-full md:w-28"
              inputMode="numeric"
              value={filters.minLand}
              onChange={(e) => set({ minLand: e.target.value })}
              placeholder="Any"
            />
          </Field>
        </div>

        {facets && facets.regions.length > 1 && (
          <ChipGroup
            label="District"
            options={facets.regions}
            selected={filters.regions}
            onChange={(regions) => set({ regions })}
          />
        )}

        {facets && facets.propertyTypes.length > 1 && (
          <ChipGroup
            label="Property type"
            options={facets.propertyTypes}
            selected={filters.types}
            onChange={(types) => set({ types })}
            capitalise
          />
        )}

        {suburbOptions.length > 1 && (
          <ChipGroup
            label="Suburb"
            options={suburbOptions}
            selected={filters.suburbs}
            onChange={(suburbs) => set({ suburbs })}
            limit={showAll ? undefined : 12}
            onShowMore={() => setShowAll(true)}
          />
        )}

        <div className="flex flex-wrap items-center gap-x-4 border-t border-slate-200 pt-3">
          <Check
            label="Garage only"
            checked={filters.garageOnly}
            onChange={(v) => set({ garageOnly: v })}
          />
          <Check
            label="Meets all my criteria"
            title="Applies the hard filters from your buyer profile in Settings."
            checked={filters.passesOnly}
            onChange={(v) => set({ passesOnly: v })}
          />
          <Check
            label="Published price only"
            title="Hides listings where the headline figure is HouseScout's estimate rather than the vendor's asking price."
            checked={filters.pricedOnly}
            onChange={(v) => set({ pricedOnly: v })}
          />
          <span className="ml-auto hidden items-center gap-3 text-sm text-slate-500 md:flex">
            {loading ? "Filtering…" : `${listings.length} match${listings.length === 1 ? "" : "es"}`}
            {active > 0 && (
              <button className="btn-ghost" onClick={() => setFilters(EMPTY)}>
                Clear {active} filter{active === 1 ? "" : "s"}
              </button>
            )}
          </span>
        </div>

        {/* Pinned to the bottom of the sheet so applying is always one thumb-tap away. */}
        <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-slate-200 bg-white px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 md:hidden">
          {active > 0 && (
            <button type="button" className="btn-ghost" onClick={() => setFilters(EMPTY)}>
              Clear
            </button>
          )}
          <button type="button" className="btn flex-1" onClick={() => setFiltersOpen(false)}>
            {loading ? "Filtering…" : `Show ${listings.length} match${listings.length === 1 ? "" : "es"}`}
          </button>
        </div>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : listings.length === 0 ? (
        <EmptyState active={active} onClear={() => setFilters(EMPTY)} />
      ) : view === "map" ? (
        <ListingsMap listings={capped} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {capped.map((l) => (
              <ListingCard key={l.id} l={l} />
            ))}
          </div>
          {hidden > 0 && (
            <UpgradePrompt
              feature="unlimitedListings"
              title={`${hidden} more listings match`}
              blurb={`The free plan shows your top ${FREE_LISTING_LIMIT} matches. Upgrade to browse every listing, with modelled valuations and Deal Radar.`}
            />
          )}
        </>
      )}
    </div>
  );
}

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <span className="text-xs font-medium text-slate-500">{label}</span>
      {children}
    </div>
  );
}

function Check({
  label,
  title,
  checked,
  onChange,
}: {
  label: string;
  title?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex min-h-[2.75rem] items-center gap-3 text-sm md:min-h-0 md:gap-2" title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/** Multi-select as toggleable chips — nothing selected means "all", not "none". */
function ChipGroup({
  label,
  options,
  selected,
  onChange,
  limit,
  onShowMore,
  capitalise = false,
}: {
  label: string;
  options: Facet[];
  selected: string[];
  onChange: (next: string[]) => void;
  limit?: number;
  onShowMore?: () => void;
  capitalise?: boolean;
}) {
  // A selected option always stays visible, even past the display limit — otherwise
  // trimming the list would hide an active filter and make the results inexplicable.
  const shown = limit
    ? options.filter((o, i) => i < limit || selected.includes(o.value))
    : options;
  const remaining = options.length - shown.length;

  function toggle(value: string) {
    onChange(
      selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value],
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-500">
        {label}
        {selected.length > 0 && ` · ${selected.length} selected`}
      </span>
      <div className="flex flex-wrap gap-2 md:gap-1.5">
        {shown.map((o) => {
          const on = selected.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(o.value)}
              className={`press rounded-full border px-3.5 py-2 text-sm transition md:px-2.5 md:py-1 md:text-xs ${
                on
                  ? "border-brand bg-brand text-white"
                  : "border-slate-300 text-slate-600 hover:border-slate-400"
              }`}
            >
              <span className={capitalise ? "capitalize" : ""}>{o.label}</span>
              <span className={on ? "ml-1 opacity-80" : "ml-1 text-slate-400"}>{o.count}</span>
            </button>
          );
        })}
        {remaining > 0 && onShowMore && (
          <button type="button" className="px-2 py-2 text-sm text-brand-dark underline md:py-1 md:text-xs" onClick={onShowMore}>
            +{remaining} more
          </button>
        )}
        {selected.length > 0 && (
          <button type="button" className="px-2 py-2 text-sm text-slate-500 underline md:py-1 md:text-xs" onClick={() => onChange([])}>
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Why the list is empty.
 *
 * "Nothing was scraped" and "nothing clears your criteria" look identical on
 * screen and need opposite responses, so this checks whether the dataset has
 * anything in it at all before blaming the build. Now that budget, garage and
 * backyard are the visitor's own settings, an all-fail result is the common case
 * and the message has to point at them.
 */
function EmptyState({ active, onClear }: { active: number; onClear: () => void }) {
  const [total, setTotal] = useState<number | null>(null);
  useEffect(() => {
    api.listings("?passes_only=false&limit=1").then((r) => setTotal(r.length));
  }, []);

  if (total === 0) {
    return (
      <p className="text-sm text-slate-500">
        No listings in this build — the scrape returned nothing.
      </p>
    );
  }
  return (
    <div className="card p-4 text-sm">
      <p className="font-medium text-slate-900">Nothing clears your criteria.</p>
      <p className="mt-1 text-slate-600">
        There are listings here, but every one is knocked out by your budget, the garage or
        backyard requirement, or the filters above.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {active > 0 && (
          <button className="btn-ghost" onClick={onClear}>
            Clear the filters
          </button>
        )}
        <Link href="/settings" className="btn-ghost">
          Loosen my criteria
        </Link>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Raising the price ceiling under <strong>💰 Your numbers</strong> is usually the fastest fix.
      </p>
    </div>
  );
}
