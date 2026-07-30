"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Feature,
  Tier,
  hasFeature,
  requiredPlan,
  resolveEntitlement,
  getTier,
} from "@/lib/subscription";

/**
 * Current subscription tier, kept in sync across components and tabs.
 *
 * Returns `null` until resolved so gated UI can render a skeleton rather than
 * flashing the upgrade prompt at a subscriber on every page load.
 */
export function useTier(): Tier | null {
  const [tier, setTier] = useState<Tier | null>(null);

  useEffect(() => {
    let alive = true;
    resolveEntitlement().then((t) => alive && setTier(t));

    const sync = () => setTier(getTier());
    window.addEventListener("housescout:tier", sync);
    window.addEventListener("storage", sync);
    return () => {
      alive = false;
      window.removeEventListener("housescout:tier", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return tier;
}

export function useFeature(feature: Feature): { allowed: boolean; tier: Tier | null } {
  const tier = useTier();
  return { allowed: tier != null && hasFeature(tier, feature), tier };
}

/** Inline upgrade prompt naming the cheapest plan that unlocks the feature. */
export function UpgradePrompt({
  feature,
  title,
  blurb,
}: {
  feature: Feature;
  title: string;
  blurb: string;
}) {
  const plan = requiredPlan(feature);
  return (
    <div className="rounded-xl border border-dashed border-indigo-300 bg-indigo-50/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-indigo-900">
            <span aria-hidden>🔒</span> {title}
          </p>
          <p className="mt-1 text-sm text-indigo-800/80">{blurb}</p>
        </div>
        <span className="badge shrink-0 bg-indigo-600 text-white">{plan.name}</span>
      </div>
      <Link href="/pricing" className="btn mt-3">
        Unlock for ${plan.priceMonthly}/mo
      </Link>
    </div>
  );
}

/**
 * Renders `children` when the current tier includes `feature`, otherwise an
 * upgrade prompt (or `fallback`, when a page wants a teaser instead).
 */
export function Gate({
  feature,
  title,
  blurb,
  children,
  fallback,
}: {
  feature: Feature;
  title: string;
  blurb: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const { allowed, tier } = useFeature(feature);

  if (tier == null) {
    return <div className="h-24 animate-pulse rounded-xl bg-slate-100" aria-hidden />;
  }
  if (allowed) return <>{children}</>;
  return <>{fallback ?? <UpgradePrompt feature={feature} title={title} blurb={blurb} />}</>;
}

/**
 * Blurs a teaser behind the paywall so the value is visible but not readable —
 * markedly better at converting than hiding the feature entirely.
 */
export function BlurredTeaser({ children }: { children: React.ReactNode }) {
  return (
    // Blur strength matters: at 5px large figures were still legible, which gives the
    // paid number away. 9px leaves the shape and layout readable but not the values.
    <div className="pointer-events-none select-none blur-[9px] saturate-50" aria-hidden>
      {children}
    </div>
  );
}
