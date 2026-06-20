"""AI endpoints: health, per-listing insight, RAG chat, general advisor."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..ai import client, insights
from ..db import get_db
from ..finance_service import analyse_listing
from ..models import AIInsight, Listing, Score
from ..schemas import AdvisorRequest, AIResponse, ChatRequest

router = APIRouter(prefix="/api/ai", tags=["ai"])


@router.get("/health")
def ai_health():
    return client.health()


@router.post("/insight/{listing_id}", response_model=AIResponse)
def insight(listing_id: int, db: Session = Depends(get_db), refresh: bool = False):
    listing = db.get(Listing, listing_id)
    if not listing:
        raise HTTPException(404, "Listing not found")

    if not refresh:
        cached = (
            db.query(AIInsight)
            .filter(AIInsight.listing_id == listing_id, AIInsight.kind == "summary")
            .order_by(AIInsight.created_at.desc())
            .first()
        )
        if cached:
            return AIResponse(ok=True, content=cached.content, model=cached.model)

    fin = analyse_listing(listing)
    score = listing.score
    score_dict = {
        "match_score": score.match_score if score else None,
        "components": (score.components or {}).get("components") if score else None,
    }
    result = insights.listing_insight(
        {
            "address": listing.address, "suburb": listing.suburb, "price": listing.price,
            "price_text": listing.price_text, "bedrooms": listing.bedrooms,
            "bathrooms": listing.bathrooms, "has_garage": listing.has_garage,
            "land_area_m2": listing.land_area_m2, "property_type": listing.property_type,
            "description": listing.description,
        },
        fin, score_dict,
    )
    if result["ok"]:
        db.add(AIInsight(listing_id=listing_id, kind="summary",
                         content=result["content"], model=result["model"]))
        db.commit()
    return AIResponse(**result)


@router.post("/chat", response_model=AIResponse)
def chat(req: ChatRequest, db: Session = Depends(get_db)):
    """RAG-lite: retrieve top-scoring passing listings and ground the answer in them."""
    stmt = (
        select(Listing)
        .options(selectinload(Listing.enrichment), selectinload(Listing.score))
        .join(Score, isouter=True)
        .where(Listing.status == "active", Score.passes_filters.is_(True))
        .order_by(Score.match_score.desc().nullslast())
        .limit(req.limit)
    )
    rows = db.execute(stmt).scalars().unique().all()
    context = []
    for r in rows:
        fin = analyse_listing(r)
        context.append({
            "address": r.address, "suburb": r.suburb, "price": r.price,
            "bedrooms": r.bedrooms, "bathrooms": r.bathrooms, "has_garage": r.has_garage,
            "land_area_m2": r.land_area_m2, "property_type": r.property_type,
            "match_score": r.score.match_score if r.score else None,
            "rentable_rooms": fin["boarder"]["rentable_rooms"],
            "monthly_boarder_income": fin["monthly_boarder_income"],
            "net_monthly_outlay": fin["net_monthly_outlay"],
            "gross_yield_pct": fin["gross_yield_pct"],
            "payoff_years_accelerated": fin["accelerated"]["payoff_years"],
        })
    result = insights.chat_assistant(req.question, context)
    return AIResponse(**result)


@router.post("/advisor", response_model=AIResponse)
def advisor(req: AdvisorRequest):
    return AIResponse(**insights.advisor(req.question))
