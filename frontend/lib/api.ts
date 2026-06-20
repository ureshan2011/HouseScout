// Tiny typed API client. Same-origin /api/* is proxied to FastAPI (see next.config.js).

export type Enrichment = {
  land_area_m2?: number | null;
  rateable_value?: number | null;
  estimate_value?: number | null;
  rental_estimate_weekly?: number | null;
  last_sold_price?: number | null;
};

export type Score = {
  match_score: number;
  passes_filters: boolean;
  components?: { components?: Record<string, number>; rentable_rooms?: number } | null;
};

export type Listing = {
  id: number;
  source: string;
  url?: string | null;
  address?: string | null;
  suburb?: string | null;
  lat?: number | null;
  lng?: number | null;
  price?: number | null;
  price_text?: string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  car_spaces?: number | null;
  has_garage: boolean;
  land_area_m2?: number | null;
  floor_area_m2?: number | null;
  property_type?: string | null;
  description?: string | null;
  images: { url: string; position: number }[];
  enrichment?: Enrichment | null;
  score?: Score | null;
};

export type Finance = {
  loan: number;
  monthly_payment: number;
  boarder: { rentable_rooms: number; weekly_gross: number; weekly_tax_free: number; annual_gross: number };
  monthly_boarder_income: number;
  monthly_holding_costs: number;
  net_monthly_outlay: number;
  covers_mortgage: boolean;
  gross_yield_pct: number;
  net_annual_cashflow: number;
  standard: { monthly_payment: number; payoff_years: number | null; total_interest: number | null; yearly_balance: number[] };
  accelerated: { payoff_years: number | null; total_interest: number | null; yearly_balance: number[] };
  interest_saved: number | null;
  years_saved: number | null;
};

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

export const api = {
  health: () => j<any>("/api/health"),
  stats: () => j<any>("/api/stats"),
  suburbs: () => j<any[]>("/api/suburbs"),
  rates: () => j<any[]>("/api/rates"),
  listings: (qs = "") => j<Listing[]>(`/api/listings${qs}`),
  listing: (id: number) => j<Listing>(`/api/listings/${id}`),
  financeForListing: (id: number, qs = "") => j<Finance>(`/api/finance/listing/${id}${qs}`),
  scenario: (body: any) =>
    j<Finance>("/api/finance/scenario", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  financeDefaults: () => j<any>("/api/finance/defaults"),
  aiHealth: () => j<any>("/api/ai/health"),
  reindex: () => j<any>("/api/ai/reindex", { method: "POST" }),
  refreshRates: () => j<any>("/api/rates/refresh", { method: "POST" }),
  insight: (id: number, refresh = false) =>
    j<any>(`/api/ai/insight/${id}?refresh=${refresh}`, { method: "POST" }),
  chat: (question: string) =>
    j<any>("/api/ai/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question }),
    }),
  advisor: (question: string) =>
    j<any>("/api/ai/advisor", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question }),
    }),
};

export const fmt = {
  money: (n?: number | null) =>
    n == null ? "—" : new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD", maximumFractionDigits: 0 }).format(n),
  num: (n?: number | null) => (n == null ? "—" : new Intl.NumberFormat("en-NZ").format(n)),
  pct: (n?: number | null) => (n == null ? "—" : `${n.toFixed(1)}%`),
};
