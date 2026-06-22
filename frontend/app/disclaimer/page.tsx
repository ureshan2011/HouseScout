import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Disclaimer — HouseScout",
  description: "Important disclaimers for HouseScout.",
};

const UPDATED = "22 June 2026";

export default function DisclaimerPage() {
  return (
    <article className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Disclaimer</h1>
        <p className="text-sm text-slate-500">Last updated: {UPDATED}</p>
      </header>

      <Section title="1. General information only">
        <p>
          HouseScout is a personal-use research tool. All content — including listings, scores,
          financial projections, suburb statistics, mortgage rates and AI-generated analysis — is
          provided for general informational purposes only. It does not constitute financial,
          investment, legal, tax, valuation or other professional advice, and must not be relied upon
          as such.
        </p>
      </Section>

      <Section title="2. Not financial advice">
        <p>
          Nothing in this app is a recommendation to buy, sell or finance any property. The financial
          calculations (mortgage payments, boarder income, payoff timelines, yields and savings) are
          illustrative models based on assumptions and simplified inputs. Actual results will differ.
          Interest rates, lending criteria, insurance, rates bills and rental income all change over
          time and vary by individual circumstances. Before making any financial decision, obtain
          advice from a licensed financial adviser, mortgage broker, accountant and/or lawyer.
        </p>
      </Section>

      <Section title="3. Tax information">
        <p>
          References to the IRD “standard-cost” boarder method and the tax-free weekly threshold are
          general summaries that may be incomplete or out of date, and may not apply to your
          situation. Tax rules change. Confirm your obligations directly with{" "}
          <a href="https://www.ird.govt.nz/" target="_blank" rel="noreferrer">Inland Revenue (IRD)</a>{" "}
          or a qualified accountant.
        </p>
      </Section>

      <Section title="4. Listing accuracy">
        <p>
          Property listings are aggregated from third-party public sources and may be inaccurate,
          incomplete, duplicated, delayed or no longer available. Prices shown as “auction”,
          “deadline sale”, “negotiation” or similar may have no fixed value; any estimated price is
          our own approximation, not the vendor’s asking price. Land areas, bedroom counts, garage
          status and valuations may be wrong. Always verify every detail against the original listing,
          a LIM report, a registered valuation and a building inspection before acting.
        </p>
      </Section>

      <Section title="5. Estimated values and statistics">
        <p>
          Estimated values, rateable values, rental estimates, suburb medians, yields and growth
          figures are indicative only and are not registered valuations or guarantees of future
          performance. Past growth does not predict future returns.
        </p>
      </Section>

      <Section title="6. AI-generated content">
        <p>
          AI analysis is produced automatically from listing data and rules-based reasoning (and,
          optionally, a local language model you configure). It can be incorrect, incomplete or
          misleading, and should be treated as a starting point for your own research — never as a
          substitute for professional due diligence.
        </p>
      </Section>

      <Section title="7. External links and sources">
        <p>
          The app links to and draws from third-party websites. We do not control and are not
          responsible for their content, accuracy or availability. Trademarks and listing content
          belong to their respective owners; they are referenced here for personal, non-commercial
          research and are not endorsements.
        </p>
      </Section>

      <Section title="8. Limitation of liability">
        <p>
          To the maximum extent permitted by law, the authors of HouseScout accept no liability for
          any loss or damage (including financial loss) arising from use of, or reliance on, this app
          or its content. You use it at your own risk.
        </p>
      </Section>

      <Section title="9. Data source acknowledgement">
        <p>
          Land parcel data is sourced from Land Information New Zealand (LINZ) and used under the{" "}
          <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">Creative Commons Attribution 4.0</a>{" "}
          licence. Other data remains the property of its respective sources.
        </p>
      </Section>

      <p className="text-xs text-slate-400">
        By using HouseScout you acknowledge that you have read and understood this disclaimer.
      </p>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-slate-700">{children}</div>
    </section>
  );
}
