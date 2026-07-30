// The single place that decides which price figure to show.
//
// Over 80% of Christchurch listings publish no asking price (auction, deadline sale,
// by negotiation, POA). For those, `price` is null and the valuation model's
// `price_estimate` stands in — so every display site needs the same fallback *and*
// the same labelling, or the app ends up presenting our estimate as the vendor's
// number in some places and not others.

import { Listing } from "./api";

export type DisplayPrice = {
  /** The figure to show, or null if we have neither. */
  value: number | null;
  /** True when this is the model's estimate rather than a published price. */
  estimated: boolean;
};

export function displayPrice(
  l: Pick<Listing, "price" | "price_estimate" | "data_quality">,
): DisplayPrice {
  if (l.price != null && l.data_quality !== "estimated") {
    return { value: l.price, estimated: false };
  }
  return { value: l.price ?? l.price_estimate ?? null, estimated: true };
}
