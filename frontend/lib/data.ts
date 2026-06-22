// Static seed data — ported from backend/app/seed.py so the app is fully
// demonstrable end-to-end with no backend. Sample listings are realistic but
// illustrative (run the optional Python backend + scraper for live data).

export type RawListing = {
  id: number;
  source: string;
  source_id: string;
  url: string;
  address: string;
  suburb: string;
  lat: number;
  lng: number;
  price: number;
  price_text: string;
  bedrooms: number;
  bathrooms: number;
  car_spaces: number;
  has_garage: boolean;
  land_area_m2: number | null;
  floor_area_m2: number | null;
  property_type: string;
  description: string;
  days_on_market: number; // derived from the original listing_date offsets
  images: { url: string; position: number }[];
  enrichment: {
    land_area_m2: number | null;
    rateable_value: number | null;
    estimate_value: number | null;
    rental_estimate_weekly: number | null;
  };
};

export type Suburb = {
  name: string;
  median_price: number;
  median_rent_weekly: number;
  rental_yield: number;
  distance_cbd_km: number;
  growth_5yr_pct: number;
  notes: string;
};

export type MortgageRate = { bank: string; term_label: string; rate: number };

// Buyer profile defaults (ported from backend/app/config.py).
export const DEFAULTS = {
  max_price: 500_000,
  preapproval: 480_000,
  deposit: 50_000,
  annual_rate: 0.0519,
  term_years: 30,
  weekly_rent: 220,
};

// Affordable Christchurch suburbs (illustrative figures).
export const SUBURBS: Suburb[] = [
  { name: "Aranui", median_price: 430_000, median_rent_weekly: 480, rental_yield: 5.8, distance_cbd_km: 22, growth_5yr_pct: 8.0, notes: "Affordable east-side; rising rental demand." },
  { name: "Hornby", median_price: 510_000, median_rent_weekly: 540, rental_yield: 5.5, distance_cbd_km: 19, growth_5yr_pct: 11.0, notes: "West; near industry/transport, strong rentals." },
  { name: "Hoon Hay", median_price: 560_000, median_rent_weekly: 560, rental_yield: 5.2, distance_cbd_km: 25, growth_5yr_pct: 6.0, notes: "Popular SW family suburb." },
  { name: "Linwood", median_price: 460_000, median_rent_weekly: 510, rental_yield: 5.8, distance_cbd_km: 24, growth_5yr_pct: 4.0, notes: "Close to CBD, gentrifying." },
  { name: "Woolston", median_price: 480_000, median_rent_weekly: 520, rental_yield: 5.6, distance_cbd_km: 21, growth_5yr_pct: 5.5, notes: "Inner-east, good value." },
  { name: "New Brighton", median_price: 470_000, median_rent_weekly: 500, rental_yield: 5.5, distance_cbd_km: 18, growth_5yr_pct: 9.0, notes: "Coastal east; regeneration underway." },
  { name: "Bishopdale", median_price: 590_000, median_rent_weekly: 560, rental_yield: 4.9, distance_cbd_km: 23, growth_5yr_pct: 7.0, notes: "Established NW suburb." },
  { name: "Phillipstown", median_price: 450_000, median_rent_weekly: 500, rental_yield: 5.8, distance_cbd_km: 26, growth_5yr_pct: 3.0, notes: "Very central, smaller sections." },
  { name: "Wainoni", median_price: 440_000, median_rent_weekly: 480, rental_yield: 5.7, distance_cbd_km: 20, growth_5yr_pct: 8.5, notes: "Affordable east." },
  { name: "Riccarton", median_price: 580_000, median_rent_weekly: 600, rental_yield: 5.4, distance_cbd_km: 30, growth_5yr_pct: 4.0, notes: "Student rental hotspot; units common." },
];

// Indicative June-2026 fixed mortgage rates (lowest across major banks).
export const RATES: MortgageRate[] = [
  { bank: "ASB", term_label: "6mo", rate: 0.0449 },
  { bank: "BNZ", term_label: "6mo", rate: 0.0449 },
  { bank: "Kiwibank", term_label: "6mo", rate: 0.0449 },
  { bank: "ASB", term_label: "1yr", rate: 0.0465 },
  { bank: "BNZ", term_label: "1yr", rate: 0.0465 },
  { bank: "BNZ", term_label: "2yr", rate: 0.0519 },
  { bank: "Westpac", term_label: "2yr", rate: 0.0519 },
  { bank: "Westpac", term_label: "3yr", rate: 0.0529 },
  { bank: "Westpac", term_label: "4yr", rate: 0.0539 },
];

// (address, suburb, lat, lng, price, beds, baths, cars, garage, land_m2, floor_m2,
//  type, est_value, rv, rent_wk, description)
const RAW: [
  string, string, number, number, number, number, number, number, boolean,
  number, number, string, number, number, number, string,
][] = [
  ["12 Hampshire St", "Aranui", -43.514, 172.703, 449_000, 3, 1, 2, true, 506, 100,
    "house", 470_000, 440_000, 480,
    "Tidy 3-bedroom weatherboard with single internal garage plus carport, fully fenced backyard. Heat pump. Great first home or rental with room to add value."],
  ["8 Buchanans Rd", "Hornby", -43.546, 172.527, 479_000, 4, 2, 1, true, 412, 140,
    "house", 505_000, 470_000, 560,
    "Spacious 4-bedroom, 2-bathroom home with internal-access garage and low-maintenance yard. Double glazing, close to Hornby Hub. Ideal flatmate/boarder setup."],
  ["23 Gould Cres", "Woolston", -43.560, 172.683, 465_000, 3, 1, 1, true, 480, 95,
    "house", 475_000, 450_000, 520,
    "Renovated 1950s home, single garage, sunny fenced backyard with deck. Walk to Woolston village. Strong rental returns."],
  ["5 Estuary Rd", "New Brighton", -43.508, 172.730, 439_000, 3, 1, 2, true, 600, 90,
    "house", 460_000, 430_000, 500,
    "Coastal 3-bed near the beach and new hot pools. Double garage, big backyard. Regeneration zone upside."],
  ["14a Wilsons Rd", "Phillipstown", -43.546, 172.652, 459_000, 2, 1, 1, true, 220, 80,
    "townhouse", 465_000, 445_000, 460,
    "Modern 2-bed townhouse, single garage, courtyard. Super central, low upkeep. Townhouse so smaller yard."],
  ["31 Breezes Rd", "Wainoni", -43.510, 172.698, 429_000, 3, 1, 1, true, 520, 92,
    "house", 445_000, 420_000, 480,
    "Affordable 3-bed on a full section with single garage and large lawn. Tenanted, good cashflow."],
  ["9 Matlock St", "Linwood", -43.535, 172.668, 469_000, 4, 2, 1, true, 405, 130,
    "house", 480_000, 455_000, 540,
    "4-bed near CBD with internal garage, two bathrooms, fenced yard. Perfect for renting rooms to students/professionals."],
  ["2/47 Clarence St", "Riccarton", -43.532, 172.600, 489_000, 3, 1, 1, true, 0, 105,
    "unit", 495_000, 470_000, 600,
    "Cross-lease unit steps from Riccarton Rd and Uni. Single garage, tiny shared outdoor area. High rental demand but minimal backyard."],
  ["18 Cuthberts Rd", "Aranui", -43.516, 172.708, 415_000, 3, 1, 1, true, 540, 88,
    "house", 435_000, 410_000, 470,
    "Bargain 3-bed needing cosmetic work. Garage, big section, room to add a minor dwelling (subject to council). Value-add play."],
  ["6 Halswell Rd", "Hoon Hay", -43.560, 172.610, 549_000, 4, 2, 2, true, 600, 150,
    "house", 565_000, 540_000, 600,
    "Larger 4-bed family home, double garage, established garden. Above pre-approval but excellent boarder capacity."],
];

function money(n: number): string {
  return "$" + new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
}

export const LISTINGS: RawListing[] = RAW.map((row, i) => {
  const [addr, sub, lat, lng, price, beds, baths, cars, garage, land, floor, ptype, est, rv, rent, desc] = row;
  const landVal = land || null; // seed used `land or None` -> 0 becomes null
  return {
    id: i + 1,
    source: "sample",
    source_id: `sample-${i + 1}`,
    url: `https://example.invalid/listing/${i + 1}`,
    address: addr,
    suburb: sub,
    lat,
    lng,
    price,
    price_text: money(price),
    bedrooms: beds,
    bathrooms: baths,
    car_spaces: cars,
    has_garage: garage,
    land_area_m2: landVal,
    floor_area_m2: floor,
    property_type: ptype,
    description: desc,
    days_on_market: (i * 3) % 40, // mirrors seed listing_date offsets
    images: [{ url: `https://picsum.photos/seed/house${i + 1}/640/420`, position: 0 }],
    enrichment: {
      land_area_m2: landVal,
      rateable_value: rv,
      estimate_value: est,
      rental_estimate_weekly: rent,
    },
  };
});
