"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const LS_KEY = "housescout.cookieConsent";

export function CookieConsent() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(LS_KEY)) setShow(true);
    } catch {
      // localStorage unavailable (private mode) — just don't show.
    }
  }, []);

  function dismiss() {
    try {
      localStorage.setItem(LS_KEY, new Date().toISOString());
    } catch {
      /* ignore */
    }
    setShow(false);
  }

  if (!show) return null;

  return (
    // On phones this is a slim strip floating just above the tab bar (a full-width card
    // covered a third of the screen and sat on top of the navigation); from `md` up it
    // is the original bottom card.
    <div
      className="fixed inset-x-0 z-50 px-3 md:bottom-0 md:p-4"
      style={{ bottom: "calc(var(--tabbar-h) + env(safe-area-inset-bottom) + 0.5rem)" }}
    >
      <div className="mx-auto flex max-w-3xl items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-lg md:justify-between md:p-4">
        <p className="text-xs text-slate-600 md:text-sm">
          Only essential local storage to remember your settings — no tracking.{" "}
          <Link href="/cookies" className="text-brand-dark underline">Details</Link>
        </p>
        <button className="btn shrink-0" onClick={dismiss}>
          Got it
        </button>
      </div>
    </div>
  );
}
