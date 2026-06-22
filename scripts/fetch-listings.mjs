// Build-time data fetch: pulls real Christchurch residential-for-sale listings
// from the official Trade Me Property API, downloads their photos, and writes a
// static `frontend/public/listings.json` that the GitHub Pages app loads at runtime.
//
// Auth: Trade Me public catalogue endpoints accept OAuth 1.0 with PLAINTEXT
// signature over HTTPS using just your consumer key + secret (no member token).
// Create a (free) app at https://developer.trademe.co.nz to get these, then add
// them as repo secrets TRADEME_CONSUMER_KEY / TRADEME_CONSUMER_SECRET.
//
// Defensive by design: if keys are missing or the API is unreachable it writes an
// empty list and exits 0 so the site build still succeeds (the app shows an empty
// state rather than dummy data).

import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";

const KEY = process.env.TRADEME_CONSUMER_KEY || "";
const SECRET = process.env.TRADEME_CONSUMER_SECRET || "";
const API = process.env.TRADEME_API_BASE || "https://api.trademe.co.nz/v1";
const PRICE_MAX = Number(process.env.TRADEME_PRICE_MAX || 500000);
const ROWS = Number(process.env.TRADEME_ROWS || 40);
const REGION_NAME = process.env.TRADEME_REGION_NAME || "Canterbury";
const DISTRICT_NAME = process.env.TRADEME_DISTRICT_NAME || "Christchurch City";
const MAX_PHOTOS = Number(process.env.TRADEME_MAX_PHOTOS || 6);

const PUBLIC_DIR = join(process.cwd(), "frontend", "public");
const PHOTO_DIR = join(PUBLIC_DIR, "photos");
const OUT_JSON = join(PUBLIC_DIR, "listings.json");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function authHeader() {
  // PLAINTEXT signature = consumer_secret + "&" + token_secret(empty), percent-encoded.
  const sig = `${encodeURIComponent(SECRET)}%26`;
  return (
    `OAuth oauth_consumer_key="${encodeURIComponent(KEY)}", ` +
    `oauth_signature_method="PLAINTEXT", oauth_signature="${sig}", oauth_version="1.0"`
  );
}

async function api(path) {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: authHeader(), Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Trade Me ${path} -> HTTP ${res.status}`);
  return res.json();
}

// ---- field parsing helpers (mirror scraper/base.py) ---- //
function parsePrice(text) {
  if (!text) return null;
  const m = String(text).replace(/,/g, "").match(/\$?\s*(\d{4,}(?:\.\d+)?)/);
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) && v > 1000 ? v : null;
}
function parseInt0(text) {
  if (text == null) return null;
  const m = String(text).match(/\d+/);
  return m ? Number(m[0]) : null;
}
function detectGarage(text, parking) {
  if (parking && /\d/.test(String(parking))) {
    const n = parseInt0(parking);
    if (n && n > 0) return true;
  }
  return /\bgarage\b|\binternal access\b|\bcarport\b/i.test(`${text || ""} ${parking || ""}`);
}
function msFromDotNetDate(s) {
  if (!s) return null;
  const m = String(s).match(/\/Date\((\d+)/);
  return m ? Number(m[1]) : null;
}

async function resolveLocality() {
  // Find the numeric region/district ids for the configured names.
  try {
    const regions = await api("/Localities.json");
    const region = (regions || []).find(
      (r) => (r.Name || "").toLowerCase() === REGION_NAME.toLowerCase(),
    );
    const district = region?.Districts?.find(
      (d) => (d.Name || "").toLowerCase() === DISTRICT_NAME.toLowerCase(),
    );
    return { region: region?.LocalityId, district: district?.DistrictId };
  } catch (e) {
    console.warn(`! Could not resolve localities (${e}); searching without them.`);
    return {};
  }
}

async function downloadPhoto(url, file) {
  try {
    const res = await fetch(url);
    if (!res.ok) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000) return false; // skip tiny/placeholder responses
    await writeFile(file, buf);
    return true;
  } catch {
    return false;
  }
}

function mapPropertyType(t) {
  const v = (t || "house").toLowerCase();
  if (v.includes("town")) return "townhouse";
  if (v.includes("apartment")) return "apartment";
  if (v.includes("unit")) return "unit";
  if (v.includes("house")) return "house";
  return v;
}

async function buildListing(summary) {
  const id = summary.ListingId;
  let d = summary;
  try {
    d = await api(`/Listings/${id}.json?photo_size=FullSize`);
  } catch (e) {
    console.warn(`! detail ${id} failed (${e}); using summary only`);
  }

  const price = parsePrice(d.PriceDisplay || summary.PriceDisplay);
  const beds = parseInt0(d.Bedrooms ?? summary.Bedrooms);
  const baths = parseInt0(d.Bathrooms ?? summary.Bathrooms);
  const parking = d.Parking ?? summary.Parking;
  const land = parseInt0(d.LandArea ?? summary.LandArea);
  const ptype = mapPropertyType(d.PropertyType || summary.PropertyType);
  const body = d.Body || "";
  const geo = d.GeographicLocation || {};
  const startMs = msFromDotNetDate(d.StartDate || summary.StartDate);
  const days = startMs ? Math.max(0, Math.round((Date.now() - startMs) / 86_400_000)) : null;

  // Photos: download up to MAX_PHOTOS and self-host them.
  const photos = (d.Photos || []).slice(0, MAX_PHOTOS);
  const images = [];
  for (let i = 0; i < photos.length; i++) {
    const v = photos[i].Value || {};
    const src = v.FullSize || v.Large || v.Gallery || v.Medium || v.List;
    if (!src) continue;
    const rel = `photos/${id}-${i}.jpg`;
    const ok = await downloadPhoto(src, join(PUBLIC_DIR, rel));
    if (ok) images.push({ url: rel, position: i });
  }

  const rv = parseInt0(d.RateableValue);

  return {
    id,
    source: "trademe",
    source_id: String(id),
    url: `https://www.trademe.co.nz/a/property/residential/sale/listing/${id}`,
    address: d.Address || summary.Address || d.Title || summary.Title || null,
    suburb: d.Suburb || summary.Suburb || null,
    lat: typeof geo.Latitude === "number" && geo.Latitude !== 0 ? geo.Latitude : null,
    lng: typeof geo.Longitude === "number" && geo.Longitude !== 0 ? geo.Longitude : null,
    price,
    price_text: d.PriceDisplay || summary.PriceDisplay || null,
    bedrooms: beds,
    bathrooms: baths,
    car_spaces: parseInt0(parking),
    has_garage: detectGarage(body, parking),
    land_area_m2: land || null,
    floor_area_m2: parseInt0(d.FloorArea) || null,
    property_type: ptype,
    description: body || null,
    days_on_market: days,
    images,
    enrichment: {
      land_area_m2: land || null,
      rateable_value: rv || null,
      estimate_value: null,
      rental_estimate_weekly: null,
    },
  };
}

async function main() {
  await mkdir(PUBLIC_DIR, { recursive: true });

  if (!KEY || !SECRET) {
    console.warn(
      "! TRADEME_CONSUMER_KEY / TRADEME_CONSUMER_SECRET not set — writing empty listings.json. " +
        "Add them as repo secrets to fetch live data.",
    );
    await writeFile(OUT_JSON, "[]\n");
    return;
  }

  // Fresh photo dir each run so removed listings don't leave orphaned images.
  await rm(PHOTO_DIR, { recursive: true, force: true });
  await mkdir(PHOTO_DIR, { recursive: true });

  const { region, district } = await resolveLocality();
  const params = new URLSearchParams({
    price_max: String(PRICE_MAX),
    rows: String(ROWS),
    sort_order: "ExpiryDesc",
    photo_size: "Thumbnail",
  });
  if (region) params.set("region", String(region));
  if (district) params.set("district", String(district));

  console.log(`Searching Trade Me (${DISTRICT_NAME}, ≤ $${PRICE_MAX.toLocaleString()}) ...`);
  const search = await api(`/Search/Property/Residential.json?${params.toString()}`);
  const list = search.List || [];
  console.log(`Found ${list.length} of ${search.TotalCount ?? "?"} listings; fetching details + photos.`);

  const out = [];
  for (const summary of list) {
    try {
      const listing = await buildListing(summary);
      out.push(listing);
      console.log(`  ✓ ${listing.address ?? listing.id} — ${listing.images.length} photo(s)`);
    } catch (e) {
      console.warn(`  ✗ ${summary.ListingId}: ${e}`);
    }
    await sleep(350); // be polite
  }

  await writeFile(OUT_JSON, JSON.stringify(out, null, 2) + "\n");
  console.log(`Wrote ${out.length} listings to ${OUT_JSON}`);
}

main().catch((e) => {
  console.error(`Listing fetch failed: ${e}`);
  // Don't fail the build — leave whatever listings.json exists (or none).
  process.exit(0);
});
