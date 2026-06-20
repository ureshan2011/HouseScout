"""Seed the database with reference data and representative Christchurch sample
listings so the whole app is demonstrable end-to-end before live scraping is wired up.

Sample listings are realistic but illustrative. Run live scraping to replace them.
Run:  python -m app.seed
"""
from __future__ import annotations

from datetime import datetime, timedelta

from .db import SessionLocal, init_db
from .models import (
    Listing,
    ListingImage,
    MortgageRate,
    PricePoint,
    PropertyEnrichment,
    Suburb,
)
from .scoring_service import rescore_all

# Affordable Christchurch suburbs (illustrative figures; refine from live data).
SUBURBS = [
    ("Aranui", 430_000, 480, 5.8, 22, 8.0, "Affordable east-side; rising rental demand."),
    ("Hornby", 510_000, 540, 5.5, 19, 11.0, "West; near industry/transport, strong rentals."),
    ("Hoon Hay", 560_000, 560, 5.2, 25, 6.0, "Popular SW family suburb."),
    ("Linwood", 460_000, 510, 5.8, 24, 4.0, "Close to CBD, gentrifying."),
    ("Woolston", 480_000, 520, 5.6, 21, 5.5, "Inner-east, good value."),
    ("New Brighton", 470_000, 500, 5.5, 18, 9.0, "Coastal east; regeneration underway."),
    ("Bishopdale", 590_000, 560, 4.9, 23, 7.0, "Established NW suburb."),
    ("Phillipstown", 450_000, 500, 5.8, 26, 3.0, "Very central, smaller sections."),
    ("Wainoni", 440_000, 480, 5.7, 20, 8.5, "Affordable east."),
    ("Riccarton", 580_000, 600, 5.4, 30, 4.0, "Student rental hotspot; units common."),
]

# Indicative June-2026 fixed mortgage rates (lowest across major banks).
RATES = [
    ("ASB", "6mo", 0.0449), ("BNZ", "6mo", 0.0449), ("Kiwibank", "6mo", 0.0449),
    ("ASB", "1yr", 0.0465), ("BNZ", "1yr", 0.0465),
    ("BNZ", "2yr", 0.0519), ("Westpac", "2yr", 0.0519),
    ("Westpac", "3yr", 0.0529), ("Westpac", "4yr", 0.0539),
]

# (address, suburb, lat, lng, price, beds, baths, cars, garage, land_m2, floor_m2,
#  type, est_value, rv, rent_wk, desc)
LISTINGS = [
    ("12 Hampshire St", "Aranui", -43.514, 172.703, 449_000, 3, 1, 2, True, 506, 100,
     "house", 470_000, 440_000, 480,
     "Tidy 3-bedroom weatherboard with single internal garage plus carport, fully fenced "
     "backyard. Heat pump. Great first home or rental with room to add value."),
    ("8 Buchanans Rd", "Hornby", -43.546, 172.527, 479_000, 4, 2, 1, True, 412, 140,
     "house", 505_000, 470_000, 560,
     "Spacious 4-bedroom, 2-bathroom home with internal-access garage and low-maintenance "
     "yard. Double glazing, close to Hornby Hub. Ideal flatmate/boarder setup."),
    ("23 Gould Cres", "Woolston", -43.560, 172.683, 465_000, 3, 1, 1, True, 480, 95,
     "house", 475_000, 450_000, 520,
     "Renovated 1950s home, single garage, sunny fenced backyard with deck. Walk to "
     "Woolston village. Strong rental returns."),
    ("5 Estuary Rd", "New Brighton", -43.508, 172.730, 439_000, 3, 1, 2, True, 600, 90,
     "house", 460_000, 430_000, 500,
     "Coastal 3-bed near the beach and new hot pools. Double garage, big backyard. "
     "Regeneration zone upside."),
    ("14a Wilsons Rd", "Phillipstown", -43.546, 172.652, 459_000, 2, 1, 1, True, 220, 80,
     "townhouse", 465_000, 445_000, 460,
     "Modern 2-bed townhouse, single garage, courtyard. Super central, low upkeep. "
     "Townhouse so smaller yard."),
    ("31 Breezes Rd", "Wainoni", -43.510, 172.698, 429_000, 3, 1, 1, True, 520, 92,
     "house", 445_000, 420_000, 480,
     "Affordable 3-bed on a full section with single garage and large lawn. Tenanted, "
     "good cashflow."),
    ("9 Matlock St", "Linwood", -43.535, 172.668, 469_000, 4, 2, 1, True, 405, 130,
     "house", 480_000, 455_000, 540,
     "4-bed near CBD with internal garage, two bathrooms, fenced yard. Perfect for "
     "renting rooms to students/professionals."),
    ("2/47 Clarence St", "Riccarton", -43.532, 172.600, 489_000, 3, 1, 1, True, 0, 105,
     "unit", 495_000, 470_000, 600,
     "Cross-lease unit steps from Riccarton Rd and Uni. Single garage, tiny shared "
     "outdoor area. High rental demand but minimal backyard."),
    ("18 Cuthberts Rd", "Aranui", -43.516, 172.708, 415_000, 3, 1, 1, True, 540, 88,
     "house", 435_000, 410_000, 470,
     "Bargain 3-bed needing cosmetic work. Garage, big section, room to add a minor "
     "dwelling (subject to council). Value-add play."),
    ("6 Halswell Rd", "Hoon Hay", -43.560, 172.610, 549_000, 4, 2, 2, True, 600, 150,
     "house", 565_000, 540_000, 600,
     "Larger 4-bed family home, double garage, established garden. Above pre-approval "
     "but excellent boarder capacity."),
]


def seed() -> None:
    init_db()
    db = SessionLocal()
    try:
        if db.query(Suburb).count() == 0:
            for n, mp, rent, yld, dcbd, growth, notes in SUBURBS:
                db.add(Suburb(
                    name=n, median_price=mp, median_rent_weekly=rent, rental_yield=yld,
                    distance_cbd_km=dcbd, growth_5yr_pct=growth, notes=notes,
                ))
        if db.query(MortgageRate).count() == 0:
            for bank, term, rate in RATES:
                db.add(MortgageRate(bank=bank, term_label=term, rate=rate))

        if db.query(Listing).count() == 0:
            now = datetime.utcnow()
            for i, row in enumerate(LISTINGS):
                (addr, sub, lat, lng, price, beds, baths, cars, garage, land, floor,
                 ptype, est, rv, rent, desc) = row
                listing = Listing(
                    source="sample", source_id=f"sample-{i+1}",
                    url=f"https://example.invalid/listing/{i+1}",
                    address=addr, suburb=sub, lat=lat, lng=lng,
                    price=price, price_text=f"${price:,.0f}",
                    bedrooms=beds, bathrooms=baths, car_spaces=cars, has_garage=garage,
                    land_area_m2=land or None, floor_area_m2=floor, property_type=ptype,
                    description=desc, agent="Sample Realty",
                    listing_date=now - timedelta(days=(i * 3) % 40),
                )
                listing.images.append(ListingImage(
                    url=f"https://picsum.photos/seed/house{i+1}/640/420", position=0))
                listing.price_points.append(PricePoint(price=price))
                listing.enrichment = PropertyEnrichment(
                    land_area_m2=land or None, rateable_value=rv, estimate_value=est,
                    rental_estimate_weekly=rent,
                )
                db.add(listing)
        db.commit()
        rescore_all(db)
        print("Seeded suburbs, rates and sample listings; scores computed.")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
