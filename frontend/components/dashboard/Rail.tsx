"use client";

import { useRef } from "react";
import Link from "next/link";
import { DashCard, Row } from "./DashCard";

export type RailItem = { row: Row; tag?: string; tone?: "dark" | "alert" };

/**
 * A titled, swipeable row of cards. Phones show one card and a peek of the next (the
 * peek is what tells you it scrolls); wider screens show several. Renders nothing for
 * an empty list rather than a heading over a blank.
 */
export function Rail({
  title,
  subtitle,
  href,
  hrefLabel = "See all",
  items,
}: {
  title: string;
  subtitle?: string;
  href?: string;
  hrefLabel?: string;
  items: RailItem[];
}) {
  const scroller = useRef<HTMLDivElement>(null);
  if (items.length === 0) return null;
  const page = (dir: 1 | -1) => {
    const el = scroller.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: "smooth" });
  };
  return (
    <section aria-label={title}>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-bold tracking-tight">{title}</h2>
          {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
        </div>
        {href && (
          <Link href={href} className="press flex min-h-[2.75rem] shrink-0 items-center text-sm font-medium text-brand-dark">
            {hrefLabel} →
          </Link>
        )}
      </div>
      {/* Bleeds to the screen edge on phones so the cards read as a scroller. The
          scroll-padding is what keeps the first card off the edge: snapping aligns a
          card to the scrollport, which ignores the element's own padding. */}
      <div className="relative">
        <div
          ref={scroller}
          className="snap-row -mx-4 gap-3 px-4 pb-2 [scroll-padding-inline:1rem] md:mx-0 md:px-0 md:[scroll-padding-inline:0]"
        >
          {items.map((it) => (
            <div key={it.row.l.id} className="w-[68%] sm:w-60 lg:w-64" style={{ scrollSnapAlign: "start" }}>
              <DashCard row={it.row} tag={it.tag} tone={it.tone} />
            </div>
          ))}
        </div>
        {/* Touch scrolls by swiping; a mouse has no horizontal wheel, so it gets buttons. */}
        {(["prev", "next"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => page(k === "next" ? 1 : -1)}
            aria-label={`Scroll ${title} ${k === "next" ? "right" : "left"}`}
            className={`absolute top-[38%] hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white text-lg text-slate-700 shadow-lg ring-1 ring-slate-200 transition hover:bg-slate-50 [@media(hover:hover)]:md:flex ${
              k === "next" ? "-right-3" : "-left-3"
            }`}
          >
            {k === "next" ? "›" : "‹"}
          </button>
        ))}
      </div>
    </section>
  );
}
