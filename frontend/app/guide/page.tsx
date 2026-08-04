"use client";

import Link from "next/link";
import { NZ } from "@/lib/strategy";
import { BOARDER_TAX_FREE_WEEKLY, MAX_BOARDERS } from "@/lib/finance";

type Section = { id: string; title: string; body: React.ReactNode };

const pct = (n: number) => `${Math.round(n * 100)}%`;

const sections: Section[] = [
  {
    id: "tests",
    title: "Three tests you have to pass",
    body: (
      <>
        <p>
          Buyers track the deposit. Banks run three tests, and the smallest answer wins.
        </p>
        <ol>
          <li>
            <strong>Deposit / LVR.</strong> {pct(NZ.ownerOccupierMaxLvr)} of value for
            owner-occupiers, {pct(NZ.investorMaxLvr)} for investors buying existing stock,{" "}
            {pct(NZ.newBuildInvestorMaxLvr)} on new builds. Banks can lend past this for a small
            share of their book — that is what a low-deposit approval is.
          </li>
          <li>
            <strong>DTI.</strong> Total debt capped at {NZ.dtiOwnerOccupier}x gross income for
            owner-occupiers, {NZ.dtiInvestor}x for investors. New builds are exempt. This is what
            usually stops a second purchase.
          </li>
          <li>
            <strong>Servicing.</strong> Repayments tested at roughly{" "}
            {NZ.servicingBuffer * 100} points above the rate you are offered, with rent counted at
            about {pct(NZ.rentShading)} and every card limit treated as drawn.
          </li>
        </ol>
        <p>
          The <Link href="/strategy">Strategy Lab</Link> runs all three and names the one that binds.
        </p>
      </>
    ),
  },
  {
    id: "costs",
    title: "What the deposit doesn't cover",
    body: (
      <>
        <p>Budget about $4,000–$6,000 on top of the deposit, before you move anything:</p>
        <ul>
          <li>Solicitor: $1,500–$2,500</li>
          <li>Builder&apos;s report: $600–$1,200</li>
          <li>LIM: $300–$500</li>
          <li>Registered valuation, if the bank wants one: $900–$1,200</li>
          <li>Moving, connections, insurance from settlement day</li>
        </ul>
        <p>
          Then a maintenance buffer. A house costs roughly 1% of its value a year to keep standing,
          and it arrives in lumps — a roof, a hot water cylinder, a retaining wall.
        </p>
      </>
    ),
  },
  {
    id: "help",
    title: "First-home help, as it stands",
    body: (
      <>
        <ul>
          <li>
            <strong>First Home Grant: gone.</strong> Scrapped on 22 May 2024. Only pre-existing
            approvals were honoured. Any calculator still adding $5,000 or $10,000 is out of date.
          </li>
          <li>
            <strong>Kāinga Ora First Home Loan: still running.</strong> 5% deposit, underwritten by
            Kāinga Ora through participating lenders, subject to income and price caps. This is the
            main way past the LVR wall.
          </li>
          <li>
            <strong>KiwiSaver first-home withdrawal.</strong> Three years of membership, and you
            must leave $1,000 in. Start the paperwork three months out — it takes 10–15 working days
            and settlement will not wait.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "strategies",
    title: "Four ways to play one house",
    body: (
      <>
        <p>
          These are the same purchase, held differently. The Strategy Lab runs all four through
          identical costs and tax so the comparison means something.
        </p>
        <ul>
          <li>
            <strong>Live in it, boarders, clear the mortgage.</strong> Rent the spare rooms, put the
            surplus into extra repayments. Lowest risk, no tenants&apos; rights complications, and
            the income is tax-free up to the IRD threshold. One asset, so growth compounds once.
          </li>
          <li>
            <strong>Live in it, boarders, recycle the equity.</strong> Same house, but the surplus
            stays liquid and you top up the mortgage to fund a deposit on a rental. Fastest growth
            in net worth, and the most exposed — a rate rise hits every property at once.
          </li>
          <li>
            <strong>Rent it out on P&amp;I.</strong> Debt falls every month. Weakest cashflow of the
            four, because you are repaying principal out of rent.
          </li>
          <li>
            <strong>Rent it out on interest-only.</strong> Best cashflow while it lasts. You own no
            more of the house in five years than you do today, and the payment steps up when the
            interest-only term ends.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "recycle",
    title: "The remortgage play, step by step",
    body: (
      <>
        <p>
          &quot;Use the equity to buy the next one&quot; is four concrete steps, and each one has a
          way of failing:
        </p>
        <ol>
          <li>
            <strong>The house grows.</strong> Value rises, or you pay the loan down, or both. Equity
            is the gap.
          </li>
          <li>
            <strong>The bank revalues it.</strong> It will release up to {pct(NZ.releaseLvr)} of
            value, minus what you still owe. On a $600k house with a $360k loan that is $120k, not
            the $240k of equity you technically hold.
          </li>
          <li>
            <strong>You top up the loan.</strong> The release is new borrowing secured against the
            first house. Your debt goes up today; the repayments come out of the same pay packet.
          </li>
          <li>
            <strong>The top-up becomes the deposit.</strong> {pct(1 - NZ.investorMaxLvr)} of the next
            purchase, plus costs. The remaining {pct(NZ.investorMaxLvr)} is a new mortgage on the new
            property.
          </li>
        </ol>
        <p>
          Net effect: you now owe roughly the full price of the second house across two properties.
          That is leverage working — in both directions.
        </p>
      </>
    ),
  },
  {
    id: "interest-only",
    title: "Interest-only, honestly",
    body: (
      <>
        <p>
          Interest-only drops the payment to just the interest. On a $400k loan at 5.5% that is about
          $1,833 a month instead of $2,271 — roughly $440 a month of breathing room.
        </p>
        <p>What it buys and what it costs:</p>
        <ul>
          <li>Cashflow now, which can turn a property that bleeds into one that holds itself.</li>
          <li>
            No equity from repayment. In five years you owe exactly what you owe today, so every
            dollar of equity has to come from the market.
          </li>
          <li>
            A payment step-up at the end. The same debt now has 25 years to clear instead of 30, so
            the P&amp;I payment is higher than it would have been.
          </li>
          <li>
            More interest over the life of the loan, because the balance sat still while it accrued.
          </li>
        </ul>
        <p>
          Banks usually grant one to five years, and typically only where the loan is comfortably
          under {pct(NZ.releaseLvr)} LVR. It is a cashflow tool, not a plan.
        </p>
      </>
    ),
  },
  {
    id: "tax",
    title: "Tax rules that change the answer",
    body: (
      <ul>
        <li>
          <strong>Boarders in your own home.</strong> Under the IRD standard-cost method, up to $
          {BOARDER_TAX_FREE_WEEKLY} a week per boarder, {MAX_BOARDERS} boarders maximum, is
          effectively tax-free. This is what makes the live-in strategy work.
        </li>
        <li>
          <strong>Rental income is taxed</strong> at your marginal rate, on rent minus interest,
          rates, insurance, upkeep and management.
        </li>
        <li>
          <strong>Interest is 100% deductible again</strong> on residential rentals from 1 April 2025.
        </li>
        <li>
          <strong>Rental losses are ring-fenced.</strong> A loss carries forward against future
          rental income. It will not reduce the tax on your salary.
        </li>
        <li>
          <strong>Bright-line test: {NZ.brightLineYears} years.</strong> Sell inside that and the gain
          is taxed. Your main home is generally exempt.
        </li>
        <li>
          <strong>Principal is not an expense.</strong> Only the interest part of the payment is
          deductible.
        </li>
      </ul>
    ),
  },
  {
    id: "blockers",
    title: "What actually stops the second purchase",
    body: (
      <>
        <p>Nearly always one of three things, in this order of frequency:</p>
        <ul>
          <li>
            <strong>DTI.</strong> On $120k of income the investor cap is about $840k of total debt.
            A $500k first home leaves $340k — not enough for a second purchase in most of the
            country.
          </li>
          <li>
            <strong>Servicing.</strong> The stressed rate is roughly {NZ.servicingBuffer * 100} points
            above what you actually pay, and only {pct(NZ.rentShading)} of rent counts. Boarder income
            usually counts for nothing here, even though it is real money.
          </li>
          <li>
            <strong>Equity.</strong> The one people plan for, and the one that binds least often.
          </li>
        </ul>
        <p>
          The Portfolio Plan tab shows which of the three blocks you, year by year, instead of
          assuming the money appears.
        </p>
      </>
    ),
  },
  {
    id: "buying",
    title: "Auctions, deadlines and offers",
    body: (
      <>
        <p>
          Most NZ stock sells without a published price. What the method changes:
        </p>
        <ul>
          <li>
            <strong>Auction.</strong> Unconditional on the fall of the hammer. Finance, builder&apos;s
            report and LIM all have to be done beforehand, at your cost, with no guarantee you win.
            Set a ceiling from comparable sales and write it down before you go.
          </li>
          <li>
            <strong>Deadline sale.</strong> Offers by a date, often multi-offer. You can still attach
            conditions, but a clean offer beats a higher conditional one more often than people expect.
          </li>
          <li>
            <strong>By negotiation / POA.</strong> The most room to move, and the least information.
          </li>
          <li>
            <strong>Asking price.</strong> A starting point, not a valuation.
          </li>
        </ul>
        <p>
          Where a listing publishes no price, HouseScout shows its own estimate and labels it. Treat
          the modelled value as your ceiling, not as a guide to the vendor&apos;s reserve.
        </p>
      </>
    ),
  },
  {
    id: "mistakes",
    title: "Five expensive beginner mistakes",
    body: (
      <ol>
        <li>
          <strong>Budgeting the mortgage, not the house.</strong> Rates, insurance and maintenance
          run $8,000–$10,000 a year on a modest home before a single repair.
        </li>
        <li>
          <strong>Assuming 52 weeks of rent.</strong> Three weeks vacant a year is a normal
          assumption, and one bad tenancy costs more than that.
        </li>
        <li>
          <strong>Treating a ring-fenced loss as a tax refund.</strong> It is not one, and it never
          was for residential rentals.
        </li>
        <li>
          <strong>Planning around today&apos;s rate.</strong> Model it 3 points higher. If the plan
          only works at 5%, it is not a plan.
        </li>
        <li>
          <strong>Counting boarder income as borrowing power.</strong> It pays the mortgage. It will
          not get you the mortgage.
        </li>
      </ol>
    ),
  },
];

export default function GuidePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Buyer guide</h1>
        <p className="mt-1 text-sm text-slate-500">
          The rules, the strategies and the arithmetic behind them. Not financial advice — see the{" "}
          <Link href="/disclaimer" className="underline">disclaimer</Link>.
        </p>
      </div>

      <nav className="card p-4">
        <div className="flex flex-wrap gap-2">
          {sections.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200"
            >
              {s.title}
            </a>
          ))}
        </div>
      </nav>

      {sections.map((s) => (
        <section key={s.id} id={s.id} className="card scroll-mt-20 p-6">
          <h2 className="mb-3 text-lg font-semibold">{s.title}</h2>
          <div className="prose-guide space-y-3 text-sm leading-relaxed text-slate-700">{s.body}</div>
        </section>
      ))}

      <div className="card bg-brand/5 p-6">
        <h2 className="mb-2 font-semibold">Put numbers on it</h2>
        <div className="flex flex-wrap gap-3">
          <Link href="/strategy" className="btn">Strategy Lab</Link>
          <Link href="/planner" className="btn-ghost">Mortgage planner</Link>
          <Link href="/listings" className="btn-ghost">Browse listings</Link>
        </div>
      </div>
    </div>
  );
}
