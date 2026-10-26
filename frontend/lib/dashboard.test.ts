import test from "node:test";
import assert from "node:assert/strict";
import {
  closesLabel,
  closingDate,
  daysUntil,
  effectivePrice,
  median,
  priceBands,
  saleMethod,
  suburbRows,
} from "./dashboard";

const today = new Date(2026, 9, 26); // 26 Oct 2026

test("saleMethod reads how the vendor is selling", () => {
  assert.equal(saleMethod({ price_text: "Auction on 11 Nov, 6:00 pm" }), "auction");
  assert.equal(saleMethod({ price_text: "Deadline sale by 12 Nov" }), "deadline");
  assert.equal(saleMethod({ price_text: "Price by negotiation" }), "negotiation");
  assert.equal(saleMethod({ price: 499000, data_quality: "observed", price_text: "Asking price $499,000" }), "published");
});

test("an auction that also shows a number is still an auction", () => {
  assert.equal(saleMethod({ price: 450000, price_text: "Auction — from $450,000" }), "auction");
});

test("an estimated price is not a published one", () => {
  assert.equal(saleMethod({ price: 500000, data_quality: "estimated", price_text: "" }), "negotiation");
});

test("effectivePrice prefers the published figure, then the estimate", () => {
  assert.equal(effectivePrice({ price: 1, price_estimate: 2 }), 1);
  assert.equal(effectivePrice({ price: null, price_estimate: 2 }), 2);
  assert.equal(effectivePrice({}), null);
});

test("closingDate parses auction and deadline text, and ignores everything else", () => {
  assert.deepEqual(closingDate({ price_text: "Deadline sale by 12 Nov" }, today), new Date(2026, 10, 12));
  assert.deepEqual(closingDate({ price_text: "Auction on 11 Nov, 6:00 pm" }, today), new Date(2026, 10, 11));
  assert.deepEqual(closingDate({ price_text: "Deadline Sale by 4th November" }, today), new Date(2026, 10, 4));
  assert.equal(closingDate({ price_text: "Asking price $499,000" }, today), null);
  assert.equal(closingDate({ price_text: "Auction" }, today), null); // no date to read
});

test("the year is whichever puts the date nearest to today", () => {
  const jan = new Date(2027, 0, 5);
  assert.deepEqual(closingDate({ price_text: "Auction on 19 Dec" }, jan), new Date(2026, 11, 19)); // just passed
  const dec = new Date(2026, 11, 20);
  assert.deepEqual(closingDate({ price_text: "Deadline sale by 5 Jan" }, dec), new Date(2027, 0, 5)); // coming up
  assert.ok(daysUntil(closingDate({ price_text: "Auction on 19 Dec" }, jan)!, jan) < 0); // so callers can drop it
});

test("impossible dates are rejected", () => {
  assert.equal(closingDate({ price_text: "Deadline sale by 31 Feb" }, today), null);
});

test("daysUntil and the label", () => {
  assert.equal(daysUntil(new Date(2026, 9, 26), today), 0);
  assert.equal(daysUntil(new Date(2026, 10, 4), today), 9);
  assert.equal(closesLabel(0), "today");
  assert.equal(closesLabel(1), "tomorrow");
  assert.equal(closesLabel(9), "in 9 days");
});

test("every price lands in exactly one band", () => {
  const prices = [150_000, 299_999, 300_000, 499_999, 500_000, 950_000, 1_000_000, 4_000_000];
  const bands = priceBands(prices, 500_000);
  assert.equal(bands.reduce((s, b) => s + b.count, 0), prices.length);
});

test("bands are tagged against the budget", () => {
  const bands = priceBands([], 500_000);
  const byLabel = Object.fromEntries(bands.map((b) => [b.label, b.fit]));
  assert.equal(byLabel["$400k–500k"], "within");
  assert.equal(byLabel["$500k–600k"], "over");
  const odd = priceBands([], 450_000).find((b) => b.lo === 400_000)!;
  assert.equal(odd.fit, "stretch"); // the budget falls inside this band
});

test("median", () => {
  assert.equal(median([]), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
});

test("suburb rows drop thin suburbs and rank by average deal", () => {
  const mk = (suburb: string, deal: number, price: number | null = 500_000) => ({ suburb, price, deal, yieldPct: 5 });
  const rows = suburbRows(
    [mk("A", 50), mk("A", 60), mk("A", 70), mk("B", 90), mk("B", 90), mk("C", 40), mk("C", 40), mk("C", 40)],
    3,
  );
  assert.deepEqual(rows.map((r) => r.suburb), ["A", "C"]); // B has two listings: dropped, despite the best average
  assert.equal(rows[0].avgDeal, 60);
});
