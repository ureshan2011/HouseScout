"use client";

import { Listing } from "@/lib/api";

// Tells the user which numbers on a listing are real and which are ours.
//
// Most Christchurch stock under $500k sells by Deadline Sale or Auction and
// publishes no price at all, so `price` on those rows is a HouseScout estimate. A
// dollar figure next to a real address reads as the asking price unless it is
// labelled, which would be misleading — and squarely a Fair Trading Act problem once
// people are paying for this. See scripts/provenance.py for how the flags are set.

const QUALITY: Record<string, { label: string; tone: string; title: string }> = {
  observed: {
    label: "Listed price",
    tone: "bg-emerald-50 text-emerald-800",
    title: "The source listing publishes this asking price.",
  },
  partial: {
    label: "Est. price",
    tone: "bg-amber-50 text-amber-800",
    title:
      "This listing publishes no price (auction / deadline sale / by negotiation). " +
      "The figure shown is HouseScout's estimate from suburb comparables, not an asking price.",
  },
  sample: {
    label: "Sample data",
    tone: "bg-slate-100 text-slate-600",
    title:
      "A demonstration record, not a live listing — shown so the app stays usable " +
      "when every scraper is blocked.",
  },
};

export function DataQualityBadge({
  listing,
  compact = false,
}: {
  listing: Pick<Listing, "data_quality" | "price_text">;
  compact?: boolean;
}) {
  const q = listing.data_quality;
  // Older corpora predate provenance annotation; say nothing rather than guess.
  if (!q) return null;
  const meta = QUALITY[q];
  if (!meta) return null;

  // A published price is the expected case — no need to shout about it on a card.
  if (compact && q === "observed") return null;

  return (
    <span className={`badge ${meta.tone}`} title={meta.title}>
      {meta.label}
      {!compact && listing.price_text ? ` · ${listing.price_text}` : ""}
    </span>
  );
}

/** Full provenance disclosure for the listing detail page. */
export function DataQualityNotice({ listing }: { listing: Listing }) {
  const q = listing.data_quality;
  if (!q) return null;
  const estimated = listing.estimated_fields ?? [];
  const meta = QUALITY[q];
  if (!meta) return null;

  const FIELD_LABELS: Record<string, string> = {
    price: "asking price",
    rateable_value: "rateable value",
    estimate_value: "estimate value",
    rental_estimate_weekly: "weekly rental estimate",
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
      <p className="font-medium text-slate-700">
        Data provenance: <span className="font-normal">{meta.title}</span>
      </p>
      {estimated.length > 0 && (
        <p className="mt-1">
          HouseScout estimates on this listing:{" "}
          {estimated.map((f) => FIELD_LABELS[f] ?? f.replace(/_/g, " ")).join(", ")}.
        </p>
      )}
      {listing.provenance?.coordinates === "suburb_centroid" && (
        <p className="mt-1">
          The map pin is placed within the suburb, not geocoded to the section.
        </p>
      )}
    </div>
  );
}
