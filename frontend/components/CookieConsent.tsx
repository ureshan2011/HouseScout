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
    <div className="fixed inset-x-0 bottom-0 z-50 p-3 sm:p-4">
      <div className="mx-auto flex max-w-3xl flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-lg sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-600">
          HouseScout uses only strictly-necessary local storage to remember your settings — no
          tracking or advertising cookies. See our{" "}
          <Link href="/cookies" className="text-brand-dark underline">Cookie Policy</Link> and{" "}
          <Link href="/privacy" className="text-brand-dark underline">Privacy Policy</Link>.
        </p>
        <button className="btn shrink-0" onClick={dismiss}>
          Got it
        </button>
      </div>
    </div>
  );
}
