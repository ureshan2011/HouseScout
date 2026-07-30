"use client";

import { useState } from "react";
import { Listing } from "@/lib/api";

// Listing photos, with a generated fallback that never leaves a blank box.
//
// Two failure modes used to surface as an empty grey rectangle:
//   1. the listing genuinely has no photo (most rows, before the photo harvester
//      in scripts/photos.py existed), and
//   2. a self-hosted or remote photo 404s at runtime.
//
// Both now render deterministic generated artwork instead — the same listing always
// gets the same colours, so the grid looks intentional rather than broken, and it
// costs no network request.

/** Stable 32-bit hash so a listing's placeholder never changes between renders. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/**
 * Generated artwork for a listing with no usable photo.
 *
 * A suburb-derived hue with a simple house/roof silhouette. Deliberately abstract:
 * it must never be mistakable for a photograph of the actual property.
 */
function PlaceholderArt({ seed, label }: { seed: string; label?: string | null }) {
  const h = hash(seed);
  const hue = h % 360;
  const hue2 = (hue + 35) % 360;
  const roofSkew = (h >> 3) % 12; // small silhouette variation
  const id = `g${h % 100000}`;

  return (
    <svg
      viewBox="0 0 320 180"
      preserveAspectRatio="xMidYMid slice"
      className="h-full w-full"
      role="img"
      aria-label={label ? `No photo available for ${label}` : "No photo available"}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={`hsl(${hue} 45% 82%)`} />
          <stop offset="100%" stopColor={`hsl(${hue2} 40% 66%)`} />
        </linearGradient>
      </defs>
      <rect width="320" height="180" fill={`url(#${id})`} />
      {/* horizon + section */}
      <rect y="132" width="320" height="48" fill={`hsl(${hue2} 30% 55%)`} opacity="0.55" />
      {/* house silhouette */}
      <g fill={`hsl(${hue} 30% 38%)`} opacity="0.62">
        <polygon points={`160,68 ${118 - roofSkew},104 ${202 + roofSkew},104`} />
        <rect x="126" y="104" width="68" height="34" />
        <rect x="196" y="112" width="26" height="26" opacity="0.75" />
      </g>
      <g fill={`hsl(${hue} 45% 88%)`} opacity="0.9">
        <rect x="136" y="112" width="14" height="12" />
        <rect x="158" y="112" width="14" height="12" />
        <rect x="150" y="128" width="12" height="10" />
      </g>
    </svg>
  );
}

export function PropertyImage({
  listing,
  index = 0,
  className = "",
}: {
  listing: Pick<Listing, "id" | "address" | "suburb" | "images">;
  index?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const photo = listing.images?.[index];
  const seed = listing.suburb || listing.address || `listing-${listing.id}`;

  if (!photo || failed) {
    return (
      <div className={`relative h-full w-full overflow-hidden ${className}`}>
        <PlaceholderArt seed={seed} label={listing.address} />
        <span className="absolute bottom-1 left-1 rounded bg-black/35 px-1.5 py-0.5 text-[10px] font-medium text-white">
          No photo
        </span>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={photo.url}
      alt={listing.address ?? "Property photo"}
      loading={index === 0 ? "eager" : "lazy"}
      onError={() => setFailed(true)}
      className={`h-full w-full object-cover ${className}`}
    />
  );
}

/** Scrollable gallery for the detail page; falls back to a single placeholder. */
export function PropertyGallery({
  listing,
}: {
  listing: Pick<Listing, "id" | "address" | "suburb" | "images">;
}) {
  const photos = listing.images ?? [];
  if (photos.length <= 1) {
    return (
      <div className="h-64 w-full overflow-hidden rounded-xl bg-slate-200 sm:h-80">
        <PropertyImage listing={listing} />
      </div>
    );
  }
  return (
    <div>
      <div className="h-64 w-full overflow-hidden rounded-xl bg-slate-200 sm:h-80">
        <PropertyImage listing={listing} />
      </div>
      <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
        {photos.slice(1, 6).map((p, i) => (
          <div key={p.url} className="h-16 w-24 shrink-0 overflow-hidden rounded-lg bg-slate-200">
            <PropertyImage listing={listing} index={i + 1} />
          </div>
        ))}
      </div>
    </div>
  );
}
