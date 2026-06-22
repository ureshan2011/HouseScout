// Server component: pre-renders one static HTML page per real listing id (from the
// build-time public/listings.json) so the dynamic route works under
// `output: 'export'` (GitHub Pages). The interactive UI lives in the client component.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ListingDetailClient from "./ListingDetailClient";

export function generateStaticParams() {
  let ids: { id: string }[] = [];
  try {
    const file = join(process.cwd(), "public", "listings.json");
    const listings = JSON.parse(readFileSync(file, "utf8")) as { id: number }[];
    ids = listings.map((l) => ({ id: String(l.id) }));
  } catch {
    /* no data fetched yet (e.g. local build without API keys) */
  }
  // `output: export` requires at least one param; emit a sentinel when there are no
  // listings yet so the build still succeeds (the page renders a "not found" state).
  return ids.length ? ids : [{ id: "0" }];
}

export default function Page() {
  return <ListingDetailClient />;
}
