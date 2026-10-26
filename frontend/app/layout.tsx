import "./globals.css";
import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { CookieConsent } from "@/components/CookieConsent";
import { YourNumbers } from "@/components/YourNumbers";
import { MobileNav } from "@/components/MobileNav";

export const metadata: Metadata = {
  title: "HouseScout — Christchurch",
  description: "AI-powered house hunting, financial analysis and investment insights for Christchurch.",
  // Added to the iPhone Home Screen it opens full-screen, like an app.
  appleWebApp: { capable: true, title: "HouseScout", statusBarStyle: "default" },
  // Don't turn street numbers and prices into phone-number links.
  formatDetection: { telephone: false },
};

// `viewport-fit=cover` lets the page extend under the Dynamic Island and the home
// indicator (the safe-area insets then keep controls clear of them). Zoom is left
// enabled on purpose: blocking pinch-zoom is an accessibility failure, and inputs are
// kept at 16px so Safari has no reason to auto-zoom.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

const nav = [
  { href: "/", label: "Dashboard" },
  { href: "/listings", label: "Listings" },
  { href: "/radar", label: "Deal Radar" },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/planner", label: "Planner" },
  { href: "/strategy", label: "Strategy" },
  { href: "/insights", label: "Insights" },
  { href: "/guide", label: "Buyer Guide" },
  { href: "/chat", label: "Assistant" },
  { href: "/pricing", label: "Plans" },
  { href: "/settings", label: "Settings" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="min-h-screen">
          <header
            className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur print:hidden"
            style={{ paddingTop: "env(safe-area-inset-top)" }}
          >
            <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2 md:gap-6 md:py-3">
              <Link href="/" className="press flex min-h-[2.75rem] items-center whitespace-nowrap text-lg font-bold text-brand-dark">
                🏠 HouseScout
              </Link>
              {/* Phones navigate from the bottom tab bar (components/MobileNav.tsx). */}
              <nav className="hidden flex-wrap gap-1 text-sm md:flex">
                {nav.map((n) => (
                  <Link key={n.href} href={n.href} className="rounded-md px-3 py-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900">
                    {n.label}
                  </Link>
                ))}
              </nav>
              {/* Every dollar on the site is worked out from these, so they belong
                  in reach from every page rather than behind Settings. */}
              <div className="ml-auto">
                <YourNumbers />
              </div>
            </div>
          </header>
          {/* The bottom padding keeps the last of the page clear of the fixed tab bar and
              the home indicator on phones. */}
          <main className="mx-auto max-w-6xl px-4 py-4 pb-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+1.5rem)] md:py-6 md:pb-6">
            {children}
          </main>
          <footer className="mx-auto max-w-6xl space-y-2 px-4 pb-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+1rem)] pt-2 text-xs text-slate-400 md:py-8 print:hidden">
            <nav className="hidden flex-wrap gap-x-4 gap-y-1 md:flex">
              <Link href="/privacy" className="hover:text-slate-600 hover:underline">Privacy Policy</Link>
              <Link href="/cookies" className="hover:text-slate-600 hover:underline">Cookie Policy</Link>
              <Link href="/disclaimer" className="hover:text-slate-600 hover:underline">Disclaimer</Link>
              <Link href="/guide" className="hover:text-slate-600 hover:underline">Buyer Guide</Link>
            </nav>
            <p>
              Personal-use tool. Property estimates are indicative, not registered valuations.
              Land data © LINZ CC-BY 4.0. Not financial, tax or legal advice — see the{" "}
              <Link href="/disclaimer" className="underline">full disclaimer</Link>.
            </p>
          </footer>
        </div>
        <MobileNav />
        <CookieConsent />
      </body>
    </html>
  );
}
