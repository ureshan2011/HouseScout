"use client";

import { Gate } from "@/components/Gate";

// Printable property report — a Pro feature that needs no PDF library.
//
// `window.print()` plus the print stylesheet in globals.css turns the detail page
// into a clean one-page report (nav, buttons and paywall prompts hidden). Browsers
// offer "Save as PDF" from the same dialog, so a buyer can take the numbers to a
// broker or the family without HouseScout shipping a rendering dependency.

export function PrintReportButton() {
  return (
    <Gate
      feature="printReport"
      title="Printable property report"
      blurb="Export this property's valuation, finance and negotiation analysis as a clean one-page PDF."
    >
      <button className="btn-ghost print:hidden" onClick={() => window.print()}>
        🖨️ Print / save as PDF
      </button>
    </Gate>
  );
}
