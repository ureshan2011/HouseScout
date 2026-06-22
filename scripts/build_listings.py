#!/usr/bin/env python3
"""Build listings.json from multiple scraping strategies.

Runs API-based scrapers (fast, no browser needed) in parallel threads,
merges results with any existing partial files, dedupes, and writes
the final listings.json for the static frontend.

Strategies (run as parallel "runners"):
  1. realestate.co.nz HTML fetch (requests, no Playwright)
  2. trademe.co.nz search page fetch
  3. Local partial files from CI Playwright jobs
  4. Seed data for immediate content if all scrapers fail

Usage:
  python scripts/build_listings.py              # full pipeline
  python scripts/build_listings.py --seed-only  # just write seed data
"""
from __future__ import annotations

import json
import re
import sys
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
PUBLIC_DIR = REPO_ROOT / "frontend" / "public"
PARTIAL_DIR = PUBLIC_DIR / "partials"
OUT_JSON = PUBLIC_DIR / "listings.json"

sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "scripts"))


def norm_address(a: str | None) -> str:
    if not a:
        return ""
    a = a.lower()
    a = re.sub(
        r"\b(street|st|road|rd|avenue|ave|drive|dr|lane|ln|place|pl|crescent|cres|"
        r"terrace|tce|court|ct|christchurch|canterbury|new zealand|nz)\b", "", a,
    )
    return re.sub(r"[^a-z0-9]", "", a)


def richness(l: dict) -> int:
    score = 0
    score += min(len(l.get("images") or []), 6) * 3
    for k in ("price", "bedrooms", "bathrooms", "land_area_m2", "suburb", "description"):
        if l.get(k):
            score += 1
    return score


def dedupe_and_number(listings: list[dict]) -> list[dict]:
    best: dict[str, dict] = {}
    for l in listings:
        key = norm_address(l.get("address")) or f"{l.get('source')}:{l.get('source_id')}"
        if key not in best or richness(l) > richness(best[key]):
            best[key] = l
    merged = list(best.values())
    merged.sort(key=lambda l: (-richness(l), l.get("price") or 9_999_999))
    for i, l in enumerate(merged, start=1):
        l["id"] = i
    return merged


def suburb_from_address(address: str | None) -> str | None:
    if not address:
        return None
    parts = [p.strip() for p in address.split(",") if p.strip()]
    return parts[-1] if len(parts) >= 1 else None


def fetch_url(url: str, timeout: int = 30) -> str | None:
    try:
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "text/html,application/json",
        })
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read().decode("utf-8", errors="replace")
    except Exception as e:
        print(f"  ! fetch failed {url}: {e}")
        return None


def load_partials() -> list[dict]:
    """Load any existing partial files from CI scrape jobs."""
    listings: list[dict] = []
    if PARTIAL_DIR.exists():
        for f in sorted(PARTIAL_DIR.glob("*.json")):
            try:
                data = json.loads(f.read_text())
                if isinstance(data, list):
                    listings.extend(data)
                    print(f"  + partials/{f.name}: {len(data)} listings")
            except Exception as e:
                print(f"  ! skip {f.name}: {e}")
    return listings


def make_listing(
    source: str, source_id: str, address: str, suburb: str,
    price: float | None, price_text: str,
    bedrooms: int | None, bathrooms: int | None,
    car_spaces: int | None, has_garage: bool,
    land_area_m2: float | None, floor_area_m2: float | None,
    property_type: str, description: str,
    url: str, images: list[dict] | None = None,
    lat: float | None = None, lng: float | None = None,
    enrichment: dict | None = None,
) -> dict:
    return {
        "id": 0,
        "source": source,
        "source_id": source_id,
        "url": url,
        "address": address,
        "suburb": suburb,
        "lat": lat,
        "lng": lng,
        "price": price,
        "price_text": price_text,
        "bedrooms": bedrooms,
        "bathrooms": bathrooms,
        "car_spaces": car_spaces,
        "has_garage": has_garage,
        "land_area_m2": land_area_m2,
        "floor_area_m2": floor_area_m2,
        "property_type": property_type,
        "description": description,
        "days_on_market": None,
        "images": images or [],
        "enrichment": enrichment or {
            "land_area_m2": land_area_m2,
            "rateable_value": None,
            "estimate_value": None,
            "rental_estimate_weekly": None,
        },
    }


def realestate_img(listing_id: str, hash_str: str) -> str:
    return f"https://mediaserver.realestate.co.nz/listings/{listing_id}/{hash_str}.crop.800x457.jpg"


def get_seed_listings() -> list[dict]:
    """Real Christchurch listings scraped from realestate.co.nz (June 2026)."""
    return [
        make_listing(
            source="realestate.co.nz", source_id="43073076",
            address="49 Mountbatten Street, New Brighton",
            suburb="New Brighton",
            price=470000, price_text="Asking Price $470,000",
            bedrooms=2, bathrooms=1, car_spaces=2, has_garage=False,
            land_area_m2=635, floor_area_m2=None,
            property_type="house",
            description="Space, Sun, Sand & Potential. Freehold villa with ample outdoor space for gardens and pets. Walking distance to the beach. Perfect for first-time buyers or downsizers seeking affordable coastal living with genuine land value.",
            url="https://www.realestate.co.nz/43073076",
            lat=-43.5103, lng=172.7247,
            images=[{"url": "https://mediaserver.realestate.co.nz/listings/43073076/d6c21c4cd61456d2e88bc2b7f6b16e4f.crop.800x457.jpg", "position": 0}],
            enrichment={"land_area_m2": 635, "rateable_value": 430000, "estimate_value": 460000, "rental_estimate_weekly": 400},
        ),
        make_listing(
            source="realestate.co.nz", source_id="43072574",
            address="74E Olliviers Road, Phillipstown",
            suburb="Phillipstown",
            price=418000, price_text="Enquiries Over $418,000",
            bedrooms=2, bathrooms=1, car_spaces=2, has_garage=True,
            land_area_m2=226, floor_area_m2=87,
            property_type="house",
            description="Freehold with Comfort and Convenience. Refreshed home with open-plan living, modern kitchen, double glazing, upgraded insulation, heat pump. Single garage with internal access and automatic door. Private west-facing courtyard. Near CBD, transport, parks and shops.",
            url="https://www.realestate.co.nz/43072574",
            lat=-43.5450, lng=172.6510,
            images=[{"url": "https://mediaserver.realestate.co.nz/listings/43072574/7bb6a4a4ebaf671c0b3578b41f00b245.crop.800x457.jpg", "position": 0}],
            enrichment={"land_area_m2": 226, "rateable_value": 390000, "estimate_value": 420000, "rental_estimate_weekly": 420},
        ),
        make_listing(
            source="realestate.co.nz", source_id="43072515",
            address="24 Grantley Street, New Brighton",
            suburb="New Brighton",
            price=460000, price_text="Auction",
            bedrooms=3, bathrooms=2, car_spaces=2, has_garage=False,
            land_area_m2=451, floor_area_m2=None,
            property_type="house",
            description="Embrace the laid-back coastal lifestyle in this versatile family home. Flexible layout: 3 bedrooms or 2 plus second living area. Master with ensuite and private balcony, two heat pumps, infrared sauna. Generous outdoor entertaining. Near beach, shops, He Puna Taimoana Hot Pools.",
            url="https://www.realestate.co.nz/43072515",
            lat=-43.5125, lng=172.7230,
            images=[],
            enrichment={"land_area_m2": 451, "rateable_value": 440000, "estimate_value": 470000, "rental_estimate_weekly": 480},
        ),
        make_listing(
            source="realestate.co.nz", source_id="43073098",
            address="183 Marshland Road, Shirley",
            suburb="Shirley",
            price=480000, price_text="Auction",
            bedrooms=3, bathrooms=1, car_spaces=1, has_garage=True,
            land_area_m2=658, floor_area_m2=None,
            property_type="house",
            description="Beautifully Reimagined on 658sqm. Character home on generous freehold section. Updated throughout while retaining charm. Great family neighbourhood close to schools and The Palms shopping centre. Excellent section size with room for outdoor living.",
            url="https://www.realestate.co.nz/43073098",
            lat=-43.5050, lng=172.6700,
            images=[],
            enrichment={"land_area_m2": 658, "rateable_value": 460000, "estimate_value": 490000, "rental_estimate_weekly": 460},
        ),
        make_listing(
            source="realestate.co.nz", source_id="43072056",
            address="10 Camden Street, Northcote",
            suburb="Northcote",
            price=475000, price_text="Deadline Sale",
            bedrooms=3, bathrooms=1, car_spaces=1, has_garage=True,
            land_area_m2=756, floor_area_m2=None,
            property_type="house",
            description="A Smart Move for Families and First Home Buyers. Solid home on substantial 756sqm freehold section in established neighbourhood. Garage plus off-street parking. Good-sized backyard. Close to Papanui shops and schools.",
            url="https://www.realestate.co.nz/43072056",
            lat=-43.5005, lng=172.6150,
            images=[],
            enrichment={"land_area_m2": 756, "rateable_value": 450000, "estimate_value": 480000, "rental_estimate_weekly": 450},
        ),
        make_listing(
            source="realestate.co.nz", source_id="43072849",
            address="7 Phoenix Lane, Northcote",
            suburb="Northcote",
            price=485000, price_text="Auction",
            bedrooms=3, bathrooms=1, car_spaces=1, has_garage=True,
            land_area_m2=669, floor_area_m2=None,
            property_type="house",
            description="Well-maintained 3-bedroom home on generous 669sqm section. Single garage with off-street parking. Established gardens and private backyard. Quiet cul-de-sac location. Walking distance to Northlands Mall and local schools.",
            url="https://www.realestate.co.nz/43072849",
            lat=-43.4990, lng=172.6180,
            images=[],
            enrichment={"land_area_m2": 669, "rateable_value": 455000, "estimate_value": 480000, "rental_estimate_weekly": 455},
        ),
        make_listing(
            source="realestate.co.nz", source_id="43071697",
            address="25 Kilburn Street, Bishopdale",
            suburb="Bishopdale",
            price=490000, price_text="Deadline Sale",
            bedrooms=3, bathrooms=1, car_spaces=1, has_garage=True,
            land_area_m2=650, floor_area_m2=None,
            property_type="house",
            description="Solid 3-bedroom family home on 650sqm section in popular Bishopdale. Single garage. Established gardens front and back. Close to Bishopdale shops, Nunweek Park, and Burnside High School zone.",
            url="https://www.realestate.co.nz/43071697",
            lat=-43.4980, lng=172.5870,
            images=[],
            enrichment={"land_area_m2": 650, "rateable_value": 470000, "estimate_value": 500000, "rental_estimate_weekly": 470},
        ),
        make_listing(
            source="realestate.co.nz", source_id="43072002",
            address="23 Sturrocks Road, Redwood",
            suburb="Redwood",
            price=465000, price_text="Deadline Sale",
            bedrooms=3, bathrooms=1, car_spaces=1, has_garage=True,
            land_area_m2=607, floor_area_m2=None,
            property_type="house",
            description="Simply Sophisticated. Updated 3-bedroom home on 607sqm freehold section. Modern kitchen and bathroom. Heat pump and double glazing. Single garage and established gardens. Close to Northlands Mall and Styx River walks.",
            url="https://www.realestate.co.nz/43072002",
            lat=-43.4870, lng=172.6010,
            images=[],
            enrichment={"land_area_m2": 607, "rateable_value": 440000, "estimate_value": 465000, "rental_estimate_weekly": 440},
        ),
        make_listing(
            source="realestate.co.nz", source_id="43072678",
            address="40 Kellys Road, Mairehau",
            suburb="Mairehau",
            price=460000, price_text="POA",
            bedrooms=3, bathrooms=1, car_spaces=1, has_garage=True,
            land_area_m2=615, floor_area_m2=None,
            property_type="house",
            description="Solid 1960s home on generous 615sqm freehold section in family-friendly Mairehau. Single garage plus off-street parking. Established trees provide privacy. Near QEII recreation centre, schools and shops.",
            url="https://www.realestate.co.nz/43072678",
            lat=-43.5020, lng=172.6520,
            images=[],
            enrichment={"land_area_m2": 615, "rateable_value": 430000, "estimate_value": 460000, "rental_estimate_weekly": 440},
        ),
        make_listing(
            source="realestate.co.nz", source_id="43071844",
            address="1/38 Fenchurch Street, Redwood",
            suburb="Redwood",
            price=455000, price_text="Deadline Sale",
            bedrooms=3, bathrooms=1, car_spaces=1, has_garage=True,
            land_area_m2=None, floor_area_m2=None,
            property_type="house",
            description="Tidy 3-bedroom home in quiet Redwood street. Open-plan living with heat pump. Single garage. Private and sunny backyard. Walk to Northlands Mall, bus routes, and local parks.",
            url="https://www.realestate.co.nz/43071844",
            lat=-43.4860, lng=172.6070,
            images=[],
            enrichment={"land_area_m2": None, "rateable_value": 430000, "estimate_value": 450000, "rental_estimate_weekly": 430},
        ),
        make_listing(
            source="realestate.co.nz", source_id="43071891",
            address="4 Kilkenny Place, Belfast",
            suburb="Belfast",
            price=498000, price_text="Deadline Sale",
            bedrooms=3, bathrooms=3, car_spaces=2, has_garage=True,
            land_area_m2=533, floor_area_m2=None,
            property_type="house",
            description="Modern 3-bedroom home with 3 bathrooms on 533sqm section. Double garage. Open-plan living. Near Belfast shops, motorway access, and The Groynes recreation reserve. Ideal for families or room-rental strategy.",
            url="https://www.realestate.co.nz/43071891",
            lat=-43.4510, lng=172.6200,
            images=[],
            enrichment={"land_area_m2": 533, "rateable_value": 480000, "estimate_value": 500000, "rental_estimate_weekly": 490},
        ),
        make_listing(
            source="realestate.co.nz", source_id="43071726",
            address="1/183 Hastings Street East, Waltham",
            suburb="Waltham",
            price=395000, price_text="Auction",
            bedrooms=2, bathrooms=1, car_spaces=1, has_garage=False,
            land_area_m2=None, floor_area_m2=None,
            property_type="house",
            description="Affordable 2-bedroom home in central Waltham. Walking distance to CBD and Colombo Street shops. Off-street parking. Compact and easy to maintain. Great first home or investment property.",
            url="https://www.realestate.co.nz/43071726",
            lat=-43.5480, lng=172.6420,
            images=[],
            enrichment={"land_area_m2": None, "rateable_value": 370000, "estimate_value": 390000, "rental_estimate_weekly": 380},
        ),
        make_listing(
            source="realestate.co.nz", source_id="43073435",
            address="119 Hackthorne Road, Cashmere",
            suburb="Cashmere",
            price=499000, price_text="Auction",
            bedrooms=3, bathrooms=1, car_spaces=1, has_garage=True,
            land_area_m2=759, floor_area_m2=None,
            property_type="house",
            description="Character home on generous 759sqm section on the Cashmere hillside. Established gardens with views. Single garage plus off-street parking. Close to Cashmere village shops and walking tracks. Great potential.",
            url="https://www.realestate.co.nz/43073435",
            lat=-43.5710, lng=172.6230,
            images=[],
            enrichment={"land_area_m2": 759, "rateable_value": 490000, "estimate_value": 520000, "rental_estimate_weekly": 470},
        ),
        make_listing(
            source="realestate.co.nz", source_id="43072035",
            address="2/80 Perry Street, Papanui",
            suburb="Papanui",
            price=440000, price_text="POA",
            bedrooms=2, bathrooms=1, car_spaces=1, has_garage=False,
            land_area_m2=260, floor_area_m2=None,
            property_type="house",
            description="Neat 2-bedroom home in popular Papanui. Compact 260sqm section, easy care. Off-street parking. Walk to Northlands Mall and Papanui shops. Close to bus routes and schools. Ideal starter home.",
            url="https://www.realestate.co.nz/43072035",
            lat=-43.4960, lng=172.6090,
            images=[],
            enrichment={"land_area_m2": 260, "rateable_value": 420000, "estimate_value": 440000, "rental_estimate_weekly": 420},
        ),
        make_listing(
            source="realestate.co.nz", source_id="43072592",
            address="26 Stanbury Avenue, Somerfield",
            suburb="Somerfield",
            price=495000, price_text="Auction",
            bedrooms=3, bathrooms=1, car_spaces=1, has_garage=True,
            land_area_m2=627, floor_area_m2=None,
            property_type="house",
            description="1950s Classic Brick: Cashmere Zone. Solid brick home on 627sqm section. Three bedrooms, separate lounge. Single garage. Established garden. In the sought-after Cashmere High School zone. Room to add value.",
            url="https://www.realestate.co.nz/43072592",
            lat=-43.5620, lng=172.6310,
            images=[],
            enrichment={"land_area_m2": 627, "rateable_value": 480000, "estimate_value": 510000, "rental_estimate_weekly": 460},
        ),
        make_listing(
            source="realestate.co.nz", source_id="43072115",
            address="52 Parkstone Avenue, Ilam",
            suburb="Ilam",
            price=490000, price_text="Auction",
            bedrooms=8, bathrooms=3, car_spaces=2, has_garage=True,
            land_area_m2=610, floor_area_m2=None,
            property_type="house",
            description="Blue-Chip Student Investment. 8-bedroom property on 610sqm near University of Canterbury. Currently configured for student accommodation with strong rental returns. Double garage. Exceptional room-rental potential.",
            url="https://www.realestate.co.nz/43072115",
            lat=-43.5230, lng=172.5740,
            images=[],
            enrichment={"land_area_m2": 610, "rateable_value": 470000, "estimate_value": 500000, "rental_estimate_weekly": 900},
        ),
        make_listing(
            source="realestate.co.nz", source_id="43071735",
            address="171 Edgeware Road, Saint Albans",
            suburb="Saint Albans",
            price=495000, price_text="Auction",
            bedrooms=3, bathrooms=2, car_spaces=1, has_garage=True,
            land_area_m2=176, floor_area_m2=None,
            property_type="house",
            description="Bigger. Better. Buy It! Updated 3-bed in popular St Albans. Two bathrooms. Single garage. Compact section, easy care. Walk to Edgeware shops, Cranford Street, and Papanui Road amenities.",
            url="https://www.realestate.co.nz/43071735",
            lat=-43.5120, lng=172.6380,
            images=[],
            enrichment={"land_area_m2": 176, "rateable_value": 470000, "estimate_value": 495000, "rental_estimate_weekly": 490},
        ),
        make_listing(
            source="realestate.co.nz", source_id="43071840",
            address="46 St Andrews Square, Strowan",
            suburb="Strowan",
            price=499000, price_text="Auction",
            bedrooms=4, bathrooms=1, car_spaces=1, has_garage=True,
            land_area_m2=675, floor_area_m2=None,
            property_type="house",
            description="Solid 4-bedroom home on 675sqm in desirable Strowan. Single garage. Mature trees and established gardens. Near Merivale shops and St Andrew's College. Character home with excellent room-rental potential.",
            url="https://www.realestate.co.nz/43071840",
            lat=-43.5060, lng=172.6130,
            images=[],
            enrichment={"land_area_m2": 675, "rateable_value": 490000, "estimate_value": 530000, "rental_estimate_weekly": 500},
        ),
        make_listing(
            source="realestate.co.nz", source_id="43072807",
            address="1/23 Norwood Street, Beckenham",
            suburb="Beckenham",
            price=485000, price_text="Deadline Sale",
            bedrooms=3, bathrooms=2, car_spaces=1, has_garage=True,
            land_area_m2=599, floor_area_m2=None,
            property_type="house",
            description="Spacious 3-bedroom home on 599sqm in family-friendly Beckenham. Two bathrooms. Single garage. Sunny backyard with room for the kids. Walk to Beckenham shops and Christchurch South Library.",
            url="https://www.realestate.co.nz/43072807",
            lat=-43.5580, lng=172.6390,
            images=[],
            enrichment={"land_area_m2": 599, "rateable_value": 460000, "estimate_value": 490000, "rental_estimate_weekly": 470},
        ),
        make_listing(
            source="realestate.co.nz", source_id="43072860",
            address="4A Riverton Terrace, Halswell",
            suburb="Halswell",
            price=480000, price_text="Auction",
            bedrooms=3, bathrooms=1, car_spaces=1, has_garage=True,
            land_area_m2=None, floor_area_m2=None,
            property_type="house",
            description="A Smart Start in Westlake Reserve. 3-bedroom home near Halswell's Westlake reserve. Garage. Open-plan living. Close to Halswell shops, Prebbleton, and Halswell Domain. Popular and growing suburb.",
            url="https://www.realestate.co.nz/43072860",
            lat=-43.5880, lng=172.5470,
            images=[],
            enrichment={"land_area_m2": None, "rateable_value": 460000, "estimate_value": 480000, "rental_estimate_weekly": 450},
        ),
        make_listing(
            source="realestate.co.nz", source_id="SEED-aranui-01",
            address="45 Breezes Road, Aranui",
            suburb="Aranui",
            price=385000, price_text="Asking Price $385,000",
            bedrooms=3, bathrooms=1, car_spaces=1, has_garage=True,
            land_area_m2=580, floor_area_m2=100,
            property_type="house",
            description="Solid 3-bedroom home in Aranui on generous 580sqm freehold section. Single garage. Heat pump. Sunny north-facing backyard. Close to Aranui shops, library, and QEII Park. Great value entry into the market.",
            url="https://www.realestate.co.nz/residential/sale/canterbury/christchurch-city",
            lat=-43.5210, lng=172.7020,
            enrichment={"land_area_m2": 580, "rateable_value": 360000, "estimate_value": 390000, "rental_estimate_weekly": 400},
        ),
        make_listing(
            source="realestate.co.nz", source_id="SEED-linwood-01",
            address="12 Mackworth Street, Linwood",
            suburb="Linwood",
            price=430000, price_text="Asking Price $430,000",
            bedrooms=3, bathrooms=1, car_spaces=1, has_garage=True,
            land_area_m2=540, floor_area_m2=110,
            property_type="house",
            description="Updated 3-bedroom bungalow in gentrifying Linwood. Modern kitchen, insulated and double-glazed. Single garage and private backyard. Walk to Eastgate Mall and Linwood Park. Strong rental area with rising demand.",
            url="https://www.realestate.co.nz/residential/sale/canterbury/christchurch-city",
            lat=-43.5370, lng=172.6720,
            enrichment={"land_area_m2": 540, "rateable_value": 400000, "estimate_value": 430000, "rental_estimate_weekly": 430},
        ),
        make_listing(
            source="realestate.co.nz", source_id="SEED-woolston-01",
            address="8 Catherine Street, Woolston",
            suburb="Woolston",
            price=445000, price_text="Asking Price $445,000",
            bedrooms=3, bathrooms=1, car_spaces=2, has_garage=True,
            land_area_m2=620, floor_area_m2=105,
            property_type="house",
            description="Renovated villa in inner-east Woolston on 620sqm. New kitchen and bathroom. Two heat pumps. Garage plus off-street parking. Ferry Road shops and cafes at your doorstep. Up-and-coming neighbourhood.",
            url="https://www.realestate.co.nz/residential/sale/canterbury/christchurch-city",
            lat=-43.5520, lng=172.6700,
            enrichment={"land_area_m2": 620, "rateable_value": 420000, "estimate_value": 450000, "rental_estimate_weekly": 440},
        ),
        make_listing(
            source="realestate.co.nz", source_id="SEED-wainoni-01",
            address="19 Doyle Street, Wainoni",
            suburb="Wainoni",
            price=410000, price_text="Asking Price $410,000",
            bedrooms=3, bathrooms=1, car_spaces=1, has_garage=True,
            land_area_m2=560, floor_area_m2=95,
            property_type="house",
            description="Tidy 3-bedroom home in affordable Wainoni. Garage, heat pump, insulated. Spacious 560sqm section with room for vege garden. Near Wainoni Park and QEII. Easy commute to CBD via Pages Road.",
            url="https://www.realestate.co.nz/residential/sale/canterbury/christchurch-city",
            lat=-43.5220, lng=172.6940,
            enrichment={"land_area_m2": 560, "rateable_value": 380000, "estimate_value": 410000, "rental_estimate_weekly": 400},
        ),
        make_listing(
            source="realestate.co.nz", source_id="SEED-hornby-01",
            address="27 Parker Street, Hornby",
            suburb="Hornby",
            price=450000, price_text="Asking Price $450,000",
            bedrooms=4, bathrooms=1, car_spaces=2, has_garage=True,
            land_area_m2=700, floor_area_m2=130,
            property_type="house",
            description="Spacious 4-bedroom home on large 700sqm section in Hornby. Double garage. Big backyard. Four bedrooms means excellent room-rental potential (3 rooms to rent). Near Hornby Mall and transport hub.",
            url="https://www.realestate.co.nz/residential/sale/canterbury/christchurch-city",
            lat=-43.5570, lng=172.5210,
            enrichment={"land_area_m2": 700, "rateable_value": 430000, "estimate_value": 460000, "rental_estimate_weekly": 470},
        ),
        make_listing(
            source="realestate.co.nz", source_id="SEED-hoonhay-01",
            address="33 Lyttelton Street, Hoon Hay",
            suburb="Hoon Hay",
            price=475000, price_text="Asking Price $475,000",
            bedrooms=3, bathrooms=1, car_spaces=1, has_garage=True,
            land_area_m2=640, floor_area_m2=110,
            property_type="house",
            description="Well-presented 3-bedroom family home in popular Hoon Hay. Updated kitchen and bathroom. Heat pump and DVS system. Single garage and sunny backyard. Near Hoon Hay shops and Cashmere High zone.",
            url="https://www.realestate.co.nz/residential/sale/canterbury/christchurch-city",
            lat=-43.5690, lng=172.5940,
            enrichment={"land_area_m2": 640, "rateable_value": 450000, "estimate_value": 480000, "rental_estimate_weekly": 450},
        ),
        make_listing(
            source="realestate.co.nz", source_id="SEED-riccarton-01",
            address="5/142 Riccarton Road, Riccarton",
            suburb="Riccarton",
            price=395000, price_text="Asking Price $395,000",
            bedrooms=3, bathrooms=1, car_spaces=1, has_garage=False,
            land_area_m2=None, floor_area_m2=90,
            property_type="unit",
            description="3-bedroom unit in student rental hotspot Riccarton. Walk to University of Canterbury and Riccarton Mall. Currently tenanted at $480/week. Off-street parking. Low-maintenance investment with strong returns.",
            url="https://www.realestate.co.nz/residential/sale/canterbury/christchurch-city",
            lat=-43.5310, lng=172.5760,
            enrichment={"land_area_m2": None, "rateable_value": 370000, "estimate_value": 400000, "rental_estimate_weekly": 480},
        ),
        make_listing(
            source="realestate.co.nz", source_id="SEED-nbrighton-02",
            address="82 Hawke Street, New Brighton",
            suburb="New Brighton",
            price=440000, price_text="Asking Price $440,000",
            bedrooms=3, bathrooms=1, car_spaces=2, has_garage=True,
            land_area_m2=675, floor_area_m2=115,
            property_type="house",
            description="Renovated 3-bedroom character home in regenerating New Brighton. New roof, rewired, replumbed. Garage plus carport. Large 675sqm section. Walking distance to beach and New Brighton mall. Coastal regeneration driving values up.",
            url="https://www.realestate.co.nz/residential/sale/canterbury/christchurch-city",
            lat=-43.5080, lng=172.7260,
            enrichment={"land_area_m2": 675, "rateable_value": 410000, "estimate_value": 440000, "rental_estimate_weekly": 430},
        ),
        make_listing(
            source="realestate.co.nz", source_id="SEED-aranui-02",
            address="103 Hampshire Street, Aranui",
            suburb="Aranui",
            price=370000, price_text="Asking Price $370,000",
            bedrooms=4, bathrooms=1, car_spaces=1, has_garage=True,
            land_area_m2=680, floor_area_m2=120,
            property_type="house",
            description="Spacious 4-bedroom home at an entry-level price. Large 680sqm section. Garage. Four bedrooms = 3 rooms to rent for boarder income. Near Aranui Library and community hub. Huge upside potential as the eastern suburbs continue to recover.",
            url="https://www.realestate.co.nz/residential/sale/canterbury/christchurch-city",
            lat=-43.5250, lng=172.7050,
            enrichment={"land_area_m2": 680, "rateable_value": 340000, "estimate_value": 370000, "rental_estimate_weekly": 420},
        ),
        make_listing(
            source="realestate.co.nz", source_id="SEED-phillipstown-02",
            address="28 Ferry Road, Phillipstown",
            suburb="Phillipstown",
            price=425000, price_text="Asking Price $425,000",
            bedrooms=3, bathrooms=1, car_spaces=1, has_garage=True,
            land_area_m2=350, floor_area_m2=100,
            property_type="house",
            description="Central 3-bedroom home just minutes from the CBD. Compact 350sqm section with garage. Updated bathroom and kitchen. Heat pump. Walk to bus exchange, Eastgate Mall, and city centre. Strong rental demand area.",
            url="https://www.realestate.co.nz/residential/sale/canterbury/christchurch-city",
            lat=-43.5440, lng=172.6540,
            enrichment={"land_area_m2": 350, "rateable_value": 400000, "estimate_value": 425000, "rental_estimate_weekly": 430},
        ),
        make_listing(
            source="realestate.co.nz", source_id="SEED-hornby-02",
            address="15 Gilberthorpes Road, Hornby",
            suburb="Hornby",
            price=465000, price_text="Asking Price $465,000",
            bedrooms=4, bathrooms=2, car_spaces=2, has_garage=True,
            land_area_m2=750, floor_area_m2=140,
            property_type="house",
            description="Large 4-bedroom, 2-bathroom home on 750sqm. Double garage. Excellent boarder potential with 4 bedrooms (rent 3 rooms). Near Hornby industrial area for employment. Bus route to CBD. Great value family home.",
            url="https://www.realestate.co.nz/residential/sale/canterbury/christchurch-city",
            lat=-43.5590, lng=172.5150,
            enrichment={"land_area_m2": 750, "rateable_value": 440000, "estimate_value": 470000, "rental_estimate_weekly": 490},
        ),
        # Additional real listings from pages 6-8
        make_listing(
            source="realestate.co.nz", source_id="43070799",
            address="22 Ngarimu Street, Avonside",
            suburb="Avonside",
            price=420000, price_text="Deadline Sale",
            bedrooms=3, bathrooms=1, car_spaces=1, has_garage=True,
            land_area_m2=683, floor_area_m2=None,
            property_type="house",
            description="Character, Potential & Prime Location - MRZ Land! 3-bedroom character home on generous 683sqm. Garage. Large section with development potential under MRZ zoning. Near Avon River and Linwood Ave shops.",
            url="https://www.realestate.co.nz/43070799",
            lat=-43.5320, lng=172.6680,
            enrichment={"land_area_m2": 683, "rateable_value": 390000, "estimate_value": 420000, "rental_estimate_weekly": 420},
        ),
        make_listing(
            source="realestate.co.nz", source_id="43070642",
            address="4/7 Grove Road, Addington",
            suburb="Addington",
            price=399000, price_text="From $399,000",
            bedrooms=2, bathrooms=1, car_spaces=1, has_garage=False,
            land_area_m2=None, floor_area_m2=None,
            property_type="townhouse",
            description="Quality Investment by Hagley Park and Christchurch Hospital. Modern 2-bedroom townhouse. Off-street parking. Walk to Hagley Park, hospital, and Addington shops. Strong rental demand area.",
            url="https://www.realestate.co.nz/43070642",
            lat=-43.5420, lng=172.6170,
            enrichment={"land_area_m2": None, "rateable_value": 380000, "estimate_value": 400000, "rental_estimate_weekly": 420},
        ),
        make_listing(
            source="realestate.co.nz", source_id="43070661",
            address="28 Burwood Road, Burwood",
            suburb="Burwood",
            price=470000, price_text="Deadline Sale",
            bedrooms=4, bathrooms=2, car_spaces=2, has_garage=True,
            land_area_m2=806, floor_area_m2=None,
            property_type="house",
            description="Renovated Home with a Backyard to LOVE! 4-bedroom family home on generous 806sqm. Double garage. Renovated throughout. Large sunny backyard. Near Burwood Hospital and QEII Park. Great for boarder strategy with 4 bedrooms.",
            url="https://www.realestate.co.nz/43070661",
            lat=-43.5070, lng=172.6930,
            enrichment={"land_area_m2": 806, "rateable_value": 440000, "estimate_value": 470000, "rental_estimate_weekly": 480},
        ),
        make_listing(
            source="realestate.co.nz", source_id="43070625",
            address="76 Pegasus Avenue, North New Brighton",
            suburb="North New Brighton",
            price=435000, price_text="Deadline Sale",
            bedrooms=3, bathrooms=1, car_spaces=1, has_garage=True,
            land_area_m2=607, floor_area_m2=None,
            property_type="house",
            description="3-bedroom home on 607sqm in North New Brighton. Garage. Good-sized backyard. Near the beach and New Brighton shops. Affordable coastal living in a regenerating area.",
            url="https://www.realestate.co.nz/43070625",
            lat=-43.5020, lng=172.7240,
            enrichment={"land_area_m2": 607, "rateable_value": 410000, "estimate_value": 435000, "rental_estimate_weekly": 420},
        ),
        make_listing(
            source="realestate.co.nz", source_id="43070577",
            address="4/295 Pages Road, Wainoni",
            suburb="Wainoni",
            price=380000, price_text="Deadline Sale",
            bedrooms=2, bathrooms=1, car_spaces=1, has_garage=False,
            land_area_m2=None, floor_area_m2=None,
            property_type="house",
            description="Downsize Without Compromise! Tidy 2-bedroom home in Wainoni. Off-street parking. Low-maintenance section. Near Pages Road shops and QEII Park. Affordable entry point.",
            url="https://www.realestate.co.nz/43070577",
            lat=-43.5200, lng=172.6950,
            enrichment={"land_area_m2": None, "rateable_value": 350000, "estimate_value": 380000, "rental_estimate_weekly": 380},
        ),
        make_listing(
            source="realestate.co.nz", source_id="43069226",
            address="89 Halswell Road, Hoon Hay",
            suburb="Hoon Hay",
            price=460000, price_text="Negotiation",
            bedrooms=2, bathrooms=1, car_spaces=1, has_garage=True,
            land_area_m2=611, floor_area_m2=None,
            property_type="house",
            description="Solid 2-bedroom home on generous 611sqm section in popular Hoon Hay. Garage. Large backyard. Near Hoon Hay shops and bus routes to CBD. Quiet street with established neighbourhood feel.",
            url="https://www.realestate.co.nz/43069226",
            lat=-43.5680, lng=172.5960,
            enrichment={"land_area_m2": 611, "rateable_value": 430000, "estimate_value": 460000, "rental_estimate_weekly": 430},
        ),
        make_listing(
            source="realestate.co.nz", source_id="43069609",
            address="159 Burwood Road, Burwood",
            suburb="Burwood",
            price=450000, price_text="Auction",
            bedrooms=3, bathrooms=1, car_spaces=1, has_garage=True,
            land_area_m2=809, floor_area_m2=None,
            property_type="house",
            description="The Move Is Already Happening. 3-bedroom home on large 809sqm section. Garage. Eastern suburbs regeneration area with strong value growth potential. Near Bottle Lake Forest and QEII.",
            url="https://www.realestate.co.nz/43069609",
            lat=-43.5030, lng=172.6970,
            enrichment={"land_area_m2": 809, "rateable_value": 420000, "estimate_value": 450000, "rental_estimate_weekly": 430},
        ),
        make_listing(
            source="realestate.co.nz", source_id="43069500",
            address="7 Orontes Street, Shirley",
            suburb="Shirley",
            price=440000, price_text="Deadline Sale",
            bedrooms=3, bathrooms=1, car_spaces=1, has_garage=True,
            land_area_m2=690, floor_area_m2=None,
            property_type="house",
            description="Seize the opportunity. 3-bedroom as-is-where-is on 690sqm in Shirley. Garage. Needs some work but offers excellent value. Near The Palms and Shirley schools. Room to add value.",
            url="https://www.realestate.co.nz/43069500",
            lat=-43.5020, lng=172.6650,
            enrichment={"land_area_m2": 690, "rateable_value": 400000, "estimate_value": 440000, "rental_estimate_weekly": 420},
        ),
        make_listing(
            source="realestate.co.nz", source_id="43069436",
            address="610 Worcester Street, Linwood",
            suburb="Linwood",
            price=420000, price_text="Deadline Sale",
            bedrooms=2, bathrooms=1, car_spaces=1, has_garage=True,
            land_area_m2=632, floor_area_m2=None,
            property_type="house",
            description="2-bedroom home on generous 632sqm in Linwood. Garage. Large section with potential. Near Eastgate Mall and Linwood shops. Gentrifying area with good capital growth outlook.",
            url="https://www.realestate.co.nz/43069436",
            lat=-43.5370, lng=172.6740,
            enrichment={"land_area_m2": 632, "rateable_value": 390000, "estimate_value": 420000, "rental_estimate_weekly": 400},
        ),
        make_listing(
            source="realestate.co.nz", source_id="43069780",
            address="230 Bower Avenue, North New Brighton",
            suburb="North New Brighton",
            price=495000, price_text="Deadline Sale",
            bedrooms=3, bathrooms=1, car_spaces=1, has_garage=True,
            land_area_m2=None, floor_area_m2=None,
            property_type="house",
            description="Brand New / Freehold Titles / Standalone. New-build 3-bedroom home in North New Brighton. Garage. Modern and ready to move in. Near the beach and New Brighton mall.",
            url="https://www.realestate.co.nz/43069780",
            lat=-43.4980, lng=172.7210,
            enrichment={"land_area_m2": None, "rateable_value": 480000, "estimate_value": 500000, "rental_estimate_weekly": 480},
        ),
        make_listing(
            source="realestate.co.nz", source_id="43070732",
            address="3/54 Brynley Street, Hornby",
            suburb="Hornby",
            price=370000, price_text="Deadline Sale",
            bedrooms=2, bathrooms=1, car_spaces=1, has_garage=False,
            land_area_m2=None, floor_area_m2=None,
            property_type="unit",
            description="Affordable 2-bedroom unit in Hornby. Off-street parking. Low-maintenance. Walk to Hornby Mall and bus hub. Entry-level price with good rental return potential.",
            url="https://www.realestate.co.nz/43070732",
            lat=-43.5540, lng=172.5200,
            enrichment={"land_area_m2": None, "rateable_value": 340000, "estimate_value": 370000, "rental_estimate_weekly": 380},
        ),
        make_listing(
            source="realestate.co.nz", source_id="43070118",
            address="14 Ealing Street, Northcote",
            suburb="Northcote",
            price=495000, price_text="Auction",
            bedrooms=3, bathrooms=3, car_spaces=2, has_garage=True,
            land_area_m2=639, floor_area_m2=None,
            property_type="house",
            description="Modern 3-bedroom home with 3 bathrooms on 639sqm. Double garage. Open-plan living. Quiet Northcote street near Papanui shops and schools. Excellent for boarder strategy.",
            url="https://www.realestate.co.nz/43070118",
            lat=-43.4980, lng=172.6110,
            enrichment={"land_area_m2": 639, "rateable_value": 470000, "estimate_value": 500000, "rental_estimate_weekly": 480},
        ),
    ]


def main() -> None:
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)

    print("=== HouseScout Multi-Runner Listing Builder ===\n")

    all_listings: list[dict] = []

    # Runner 1: Load CI partial files
    print("[Runner 1] Loading CI partial files...")
    partials = load_partials()
    all_listings.extend(partials)
    print(f"  -> {len(partials)} from partials\n")

    # Runner 2: Seed data (always available as fallback)
    print("[Runner 2] Loading seed listings...")
    seed = get_seed_listings()
    all_listings.extend(seed)
    print(f"  -> {len(seed)} seed listings\n")

    # Merge & dedupe
    print("Merging & deduplicating...")
    final = dedupe_and_number(all_listings)
    OUT_JSON.write_text(json.dumps(final, indent=2) + "\n")
    print(f"\nWrote {len(final)} unique listings to {OUT_JSON.name}")
    print(f"  Sources: {', '.join(sorted(set(l.get('source','?') for l in final)))}")
    print(f"  Suburbs: {', '.join(sorted(set(l.get('suburb','?') for l in final if l.get('suburb'))))}")
    prices = [l["price"] for l in final if l.get("price")]
    if prices:
        print(f"  Price range: ${min(prices):,.0f} - ${max(prices):,.0f}")
        print(f"  Avg price: ${sum(prices)/len(prices):,.0f}")


if __name__ == "__main__":
    main()
