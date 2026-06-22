import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import { CookieConsent } from "@/components/CookieConsent";

export const metadata: Metadata = {
  title: "HouseScout — Christchurch",
  description: "AI-powered house hunting, financial analysis and investment insights for Christchurch.",
};

const nav = [
  { href: "/", label: "Dashboard" },
  { href: "/listings", label: "Listings" },
  { href: "/planner", label: "Planner" },
  { href: "/insights", label: "Insights" },
  { href: "/guide", label: "Buyer Guide" },
  { href: "/chat", label: "AI Chat" },
  { href: "/settings", label: "Settings" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="min-h-screen">
          <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
            <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
              <Link href="/" className="text-lg font-bold text-brand-dark">
                🏠 HouseScout
              </Link>
              <nav className="flex flex-wrap gap-1 text-sm">
                {nav.map((n) => (
                  <Link key={n.href} href={n.href} className="rounded-md px-3 py-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900">
                    {n.label}
                  </Link>
                ))}
              </nav>
            </div>
          </header>
          <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
          <footer className="mx-auto max-w-6xl space-y-2 px-4 py-8 text-xs text-slate-400">
            <nav className="flex flex-wrap gap-x-4 gap-y-1">
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
        <CookieConsent />
      </body>
    </html>
  );
}
