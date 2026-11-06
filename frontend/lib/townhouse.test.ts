import test from "node:test";
import assert from "node:assert/strict";
import { fitsTownhouseBrief, looksNewBuild, townhouseShortlist } from "./townhouse";

const base = { property_type: "townhouse", has_garage: true, price: 385_000, description: "Brand new 2-bed townhouse" };
const brief = { maxPrice: 400_000, newOnly: true };

test("a new garaged townhouse under the cap fits", () => {
  assert.equal(fitsTownhouseBrief(base, brief), true);
});

test("over the cap, no garage, or not a townhouse does not fit", () => {
  assert.equal(fitsTownhouseBrief({ ...base, price: 410_000 }, brief), false);
  assert.equal(fitsTownhouseBrief({ ...base, has_garage: false }, brief), false);
  assert.equal(fitsTownhouseBrief({ ...base, property_type: "house" }, brief), false);
});

test("an unknown price never qualifies; an estimate does", () => {
  assert.equal(fitsTownhouseBrief({ ...base, price: null }, brief), false);
  assert.equal(fitsTownhouseBrief({ ...base, price: null, price_estimate: 390_000 }, brief), true);
});

test("new-only reads the listing text; off lets older stock through", () => {
  const old = { ...base, description: "Tidy 2000s townhouse, renovated kitchen" };
  assert.equal(fitsTownhouseBrief(old, brief), false);
  assert.equal(fitsTownhouseBrief(old, { ...brief, newOnly: false }), true);
});

test("looksNewBuild accepts build language and rejects condition language", () => {
  assert.equal(looksNewBuild({ description: "Newly built, 10 year builder warranty" }), true);
  assert.equal(looksNewBuild({ description: "Built in 2026, titles issued" }), true);
  assert.equal(looksNewBuild({ description: "Immaculate, as new condition, modern" }), false);
});

test("shortlist is cheapest first", () => {
  const rows = [{ ...base, price: 395_000 }, { ...base, price: 360_000 }, { ...base, price: 450_000 }];
  assert.deepEqual(townhouseShortlist(rows, brief).map((r) => r.price), [360_000, 395_000]);
});
