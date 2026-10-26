// The complimentary-tier rule: what a visitor with no licence gets, and that holding a
// licence can only ever raise it. Written against COMPLIMENTARY_TIER rather than a
// hard-coded "pro", so flipping the setting back to "free" (restoring the paywall)
// still leaves these passing.
import test from "node:test";
import assert from "node:assert/strict";
import {
  COMPLIMENTARY_TIER,
  FEATURE_TIER,
  TIER_ORDER,
  Feature,
  Tier,
  effectiveTier,
  hasFeature,
  isComplimentary,
} from "./subscription";

const TIERS: Tier[] = ["free", "pro", "investor"];
const FEATURES = Object.keys(FEATURE_TIER) as Feature[];

test("nobody ends up below the complimentary baseline", () => {
  for (const t of TIERS) {
    assert.ok(TIER_ORDER[effectiveTier(t)] >= TIER_ORDER[COMPLIMENTARY_TIER], t);
  }
});

test("a higher tier is never lowered by the baseline", () => {
  for (const t of TIERS) {
    if (TIER_ORDER[t] >= TIER_ORDER[COMPLIMENTARY_TIER]) assert.equal(effectiveTier(t), t);
  }
});

test("an unlicensed visitor gets exactly the features at or below the baseline", () => {
  const visitor = effectiveTier("free");
  for (const f of FEATURES) {
    const expected = TIER_ORDER[FEATURE_TIER[f]] <= TIER_ORDER[COMPLIMENTARY_TIER];
    assert.equal(hasFeature(visitor, f), expected, f);
  }
});

test("tiers above the baseline stay paid", () => {
  const visitor = effectiveTier("free");
  for (const f of FEATURES) {
    if (TIER_ORDER[FEATURE_TIER[f]] > TIER_ORDER[COMPLIMENTARY_TIER]) {
      assert.equal(hasFeature(visitor, f), false, f);
      assert.equal(hasFeature("investor", f), true, f);
    }
  }
});

test("isComplimentary matches the baseline", () => {
  for (const t of TIERS) {
    assert.equal(isComplimentary(t), TIER_ORDER[t] <= TIER_ORDER[COMPLIMENTARY_TIER], t);
  }
});
