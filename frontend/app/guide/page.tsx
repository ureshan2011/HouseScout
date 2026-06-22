"use client";

import Link from "next/link";

const sections = [
  {
    title: "Christchurch Market Snapshot (June 2026)",
    content: `The Christchurch residential market remains one of New Zealand's most accessible for first-home buyers. Median house prices sit around $590,000 city-wide, but pockets under $500,000 exist — particularly in the eastern suburbs (Aranui, Linwood, Wainoni, New Brighton), the south-west (Hornby, Hoon Hay), and parts of the north (Redwood, Belfast).

Interest rates have eased from their 2023-24 highs, with 1-year fixed rates now available around 4.65%. Combined with the First Home Grant (up to $10,000 for new builds, $5,000 for existing homes) and the ability to use KiwiSaver for the deposit, the market is more accessible than it has been in years.

Auction remains the dominant sale method — roughly 60% of listings don't show a price upfront. This creates opportunity for prepared buyers who've done their homework on comparable sales.`,
  },
  {
    title: "The Boarder Strategy: Pay Off Your Mortgage Fast",
    content: `HouseScout is built around a specific wealth-building approach: buy a multi-bedroom house, live in it, and rent the spare rooms to boarders. The maths works because of a generous NZ tax rule:

Under the IRD "standard-cost" method, you can receive up to $245/week per boarder (max 4 boarders) completely tax-free. That's up to $50,960/year in tax-free income.

For a typical 4-bedroom house at $450,000:
- Mortgage payment: ~$2,140/month (at 5.19%, 30 years, $50k deposit)
- Boarder income (3 rooms x $220/week): ~$2,860/month
- Net position: $720/month surplus — your boarders are paying your mortgage AND generating extra cash

Reinvest that surplus into extra repayments and you can pay off a 30-year mortgage in under 15 years, saving over $200,000 in interest.`,
  },
  {
    title: "What to Look For",
    content: `When hunting for a boarder-strategy property, prioritise:

1. Bedrooms (4+ ideal): Each extra bedroom beyond your master is a potential income stream. A 5-bedroom home = 4 boarder rooms = maximum tax-free income.

2. Garage (essential): Secure parking is non-negotiable for both your lifestyle and resale value. Internal-access garages with automatic doors command higher rents.

3. Land area (50m² backyard minimum): Even a modest backyard adds lifestyle value and helps with consent if you ever add a minor dwelling.

4. Separate bathroom/toilet: Multiple bathrooms make the boarder arrangement more practical. An ensuite to the master means you never share.

5. Location near transport/amenities: Boarders need bus access, shops, and ideally university or hospital proximity. Riccarton, Ilam, Papanui, and Addington are boarder hotspots.`,
  },
  {
    title: "How HouseScout Scores Properties",
    content: `Every listing gets a match score (0-100) based on weighted criteria:

- Rentability (30%): Number of rooms you can rent out. A 5-bed house scores 100% here; a 2-bed scores 25%.
- Price (20%): How much headroom you have under your $500k budget. Cheaper = more deposit equity.
- Backyard (15%): Land area from 50m² (minimum pass) to 600m²+ (maximum score). Data enriched from LINZ records.
- Garage (10%): Binary — has garage or doesn't. Internal access and double garages score highest.
- Property type (10%): Houses score highest, units are acceptable, townhouses are allowed but penalised.
- Deal quality (10%): Asking below the estimated/rateable value signals a deal.
- Freshness (5%): Newer listings get a small boost — you want first-mover advantage.

Hard filters remove listings that are over budget, lack a garage, or have no backyard. The remaining listings are ranked by score.`,
  },
  {
    title: "Understanding NZ Property Pricing",
    content: `New Zealand property sales use several pricing methods:

- Asking Price / Fixed Price: The vendor states what they want. You can offer below this.
- Auction: No price guide. Research comparable sales (OneRoof, homes.co.nz) to set your max bid. Auctions are unconditional — have your finance pre-approved.
- Deadline Sale: Offers due by a date. Multi-offer situations are common. Include conditions if needed (finance, building report).
- Negotiation / By Negotiation: Similar to asking price but signals flexibility.
- POA (Price on Application): Usually higher-value properties. Agent will guide.
- Tender: Formal written offer, usually for commercial or lifestyle properties.

For HouseScout properties under $500k, about 60% go to auction. Always get a pre-approval letter from your bank before attending auctions.`,
  },
  {
    title: "First Home Grant & KiwiSaver",
    content: `If you've been contributing to KiwiSaver for 3+ years, you may qualify for:

- First Home Grant: $5,000 for existing homes ($10,000 for new builds), doubled if buying with a partner who also qualifies. Income cap: $95,000/year individual, $150,000/year combined.

- KiwiSaver withdrawal: You can withdraw your full KiwiSaver balance (minus $1,000 minimum) to put towards your deposit. Combined with the grant, this can cover most of a $50,000 deposit.

- First Home Loan (Kainga Ora): 5% deposit loans are available for eligible buyers. The income caps are $95,000 individual / $150,000 combined, and the property must be under the price cap ($500,000 for existing homes in Christchurch).

Timeline tip: Start your KiwiSaver application 3 months before you plan to buy. The withdrawal process takes 10-15 business days.`,
  },
  {
    title: "Suburb Deep Dives",
    content: `Our top picks for the boarder strategy under $500k:

Aranui ($370-430k): Best value in the city. Large sections, 3-4 bedrooms common. Regenerating with new community facilities. 5.8% gross yield.

Hornby ($420-490k): Strong employment area near industrial zone. Excellent transport links. 4-bedroom homes available. 5.5% yield.

Linwood ($400-460k): Gentrifying fast. Close to CBD. Character homes with good sections. 5.8% yield.

New Brighton ($420-470k): Coastal regeneration underway (He Puna Taimoana Hot Pools, new library). Values rising 9% over 5 years. Beach lifestyle.

Woolston ($430-480k): Inner-east, good value. Ferry Road café strip. Rising demand. 5.6% yield.

Phillipstown ($400-450k): Very central, 5 mins to CBD. Smaller sections but strong rental demand. 5.8% yield.

Wainoni ($380-440k): Affordable east. Good section sizes. Near QEII Park. 5.7% yield.

Bishopdale ($460-500k): Established NW suburb. Near Nunweek Park. Good schools. 4.9% yield.`,
  },
];

export default function GuidePage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">First Home Buyer Guide</h1>
        <p className="mt-1 text-sm text-slate-500">
          Everything you need to know about buying your first home in Christchurch using the boarder strategy.
        </p>
      </div>

      <nav className="card p-4">
        <p className="mb-2 text-xs font-medium uppercase text-slate-400">Jump to</p>
        <div className="flex flex-wrap gap-2">
          {sections.map((s, i) => (
            <a
              key={i}
              href={`#section-${i}`}
              className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200"
            >
              {s.title.split("(")[0].trim()}
            </a>
          ))}
        </div>
      </nav>

      {sections.map((s, i) => (
        <section key={i} id={`section-${i}`} className="card p-6">
          <h2 className="mb-3 text-lg font-semibold">{s.title}</h2>
          <div className="space-y-3 text-sm leading-relaxed text-slate-700">
            {s.content.split("\n\n").map((para, j) => (
              <p key={j} className="whitespace-pre-line">{para}</p>
            ))}
          </div>
        </section>
      ))}

      <div className="card bg-brand/5 p-6">
        <h2 className="mb-2 font-semibold">Ready to start?</h2>
        <p className="mb-4 text-sm text-slate-600">
          Browse our scored listings to find properties that match the boarder strategy,
          or use the financial planner to model any scenario.
        </p>
        <div className="flex gap-3">
          <Link href="/listings" className="btn">Browse listings</Link>
          <Link href="/planner" className="btn-ghost">Financial planner</Link>
        </div>
      </div>
    </div>
  );
}
