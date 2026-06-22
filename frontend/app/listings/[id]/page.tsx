// Server component: pre-renders one static HTML page per known listing id so the
// dynamic route works under `output: 'export'` (GitHub Pages). The interactive UI
// lives in the client component.
import { LISTINGS } from "@/lib/data";
import ListingDetailClient from "./ListingDetailClient";

export function generateStaticParams() {
  return LISTINGS.map((l) => ({ id: String(l.id) }));
}

export default function Page() {
  return <ListingDetailClient />;
}
