"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Phone navigation: a bottom tab bar for the screens used most, and a "More" sheet for
 * the rest.
 *
 * The desktop header lists eleven links in one row. On a 402px phone that wrapped into
 * a column that filled the entire first screen, so the primary nav lives at the bottom,
 * where a thumb reaches it, and the long tail goes behind "More". Hidden from `md` up,
 * where the header nav takes over.
 */

type Item = { href: string; label: string; icon: React.ReactNode };

const stroke = {
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

const TABS: Item[] = [
  {
    href: "/",
    label: "Home",
    icon: (
      <svg {...stroke}>
        <path d="M3 11l9-8 9 8" />
        <path d="M5 10v10h5v-6h4v6h5V10" />
      </svg>
    ),
  },
  {
    href: "/listings",
    label: "Listings",
    icon: (
      <svg {...stroke}>
        <rect x="3" y="4" width="18" height="7" rx="1.5" />
        <rect x="3" y="14" width="18" height="6" rx="1.5" />
      </svg>
    ),
  },
  {
    href: "/radar",
    label: "Radar",
    icon: (
      <svg {...stroke}>
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="4.5" />
        <path d="M12 12l5-5" />
      </svg>
    ),
  },
  {
    href: "/watchlist",
    label: "Saved",
    icon: (
      <svg {...stroke}>
        <path d="M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L12 16.9 6.7 19.6l1-5.8L3.5 9.7l5.9-.9z" />
      </svg>
    ),
  },
];

const MORE: { href: string; label: string; hint: string; emoji: string }[] = [
  { href: "/strategy", label: "Strategy", hint: "After you buy", emoji: "🧭" },
  { href: "/planner", label: "Planner", hint: "Payoff simulator", emoji: "🧮" },
  { href: "/insights", label: "Insights", hint: "Suburbs & rates", emoji: "📈" },
  { href: "/guide", label: "Buyer Guide", hint: "How buying works", emoji: "📖" },
  { href: "/chat", label: "Assistant", hint: "Ask about a listing", emoji: "💬" },
  { href: "/pricing", label: "Plans", hint: "Free & Pro", emoji: "⭐" },
  { href: "/settings", label: "Settings", hint: "Budget & filters", emoji: "⚙️" },
];

function normalise(path: string) {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

function isActive(pathname: string, href: string) {
  const p = normalise(pathname);
  return href === "/" ? p === "/" : p === href || p.startsWith(`${href}/`);
}

export function MobileNav() {
  const pathname = usePathname() || "/";
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  // Navigating (or the back gesture) closes the sheet.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  const moreActive = MORE.some((m) => isActive(pathname, m.href));

  return (
    <>
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur md:hidden print:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <ul className="mx-auto flex max-w-lg">
          {TABS.map((t) => {
            const active = isActive(pathname, t.href);
            return (
              <li key={t.href} className="flex-1">
                <Link
                  href={t.href}
                  aria-current={active ? "page" : undefined}
                  className={`press flex flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-medium ${
                    active ? "text-brand-dark" : "text-slate-500"
                  }`}
                  style={{ minHeight: "var(--tabbar-h)" }}
                >
                  {t.icon}
                  {t.label}
                </Link>
              </li>
            );
          })}
          <li className="flex-1">
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={open}
              className={`press flex w-full flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-medium ${
                moreActive ? "text-brand-dark" : "text-slate-500"
              }`}
              style={{ minHeight: "var(--tabbar-h)" }}
            >
              <svg {...stroke}>
                <circle cx="5" cy="12" r="1.2" />
                <circle cx="12" cy="12" r="1.2" />
                <circle cx="19" cy="12" r="1.2" />
              </svg>
              More
            </button>
          </li>
        </ul>
      </nav>

      {open &&
        mounted &&
        createPortal(
          <div className="fixed inset-0 z-[70] flex flex-col justify-end md:hidden" role="dialog" aria-modal="true" aria-label="More">
            <button
              type="button"
              aria-label="Close"
              className="sheet-backdrop absolute inset-0 bg-slate-900/40"
              onClick={() => setOpen(false)}
            />
            <div className="sheet relative max-h-[85dvh] overflow-y-auto rounded-t-2xl bg-white px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-2 shadow-2xl">
              <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-300" aria-hidden />
              <div className="grid grid-cols-2 gap-2.5">
                {MORE.map((m) => (
                  <Link
                    key={m.href}
                    href={m.href}
                    aria-current={isActive(pathname, m.href) ? "page" : undefined}
                    className={`press flex min-h-[4rem] items-center gap-3 rounded-xl border px-3 py-2.5 ${
                      isActive(pathname, m.href) ? "border-brand bg-teal-50" : "border-slate-200 bg-slate-50"
                    }`}
                  >
                    <span className="text-2xl" aria-hidden>
                      {m.emoji}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-slate-900">{m.label}</span>
                      <span className="block truncate text-xs text-slate-500">{m.hint}</span>
                    </span>
                  </Link>
                ))}
              </div>
              <nav aria-label="Legal" className="mt-4 flex flex-wrap gap-x-5 gap-y-1 border-t border-slate-200 pt-3 text-sm text-slate-500">
                <Link href="/privacy" className="py-2">Privacy</Link>
                <Link href="/cookies" className="py-2">Cookies</Link>
                <Link href="/disclaimer" className="py-2">Disclaimer</Link>
              </nav>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
