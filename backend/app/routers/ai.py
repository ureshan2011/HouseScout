"""Analysis endpoints: per-listing assessment, listing Q&A, general advisor.

Formerly a proxy to a local LM Studio server. Now backed by ``app.analysis``, which
computes everything from the listing's own numbers — so these endpoints are fast,
deterministic and always available. See ``app/analysis.py`` for why that changed.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import analysis
from ..db import get_db
from ..finance_service import analyse_listing
from ..models import AIInsight, Listing, Score
from ..schemas import AdvisorRequest, AIResponse, ChatRequest

router = APIRouter(prefix="/api/ai", tags=["analysis"])


@router.get("/health")
def ai_health():
    """Kept for client compatibility; the engine is in-process so it is always up."""
    return {"available": True, "engine": analysis.ENGINE_NAME, "local": True}


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
    payload = {
        "address": listing.address,
        "suburb": listing.suburb,
        "price": listing.price,
        "price_text": listing.price_text,
        "bedrooms": listing.bedrooms,
        "bathrooms": listing.bathrooms,
        "has_garage": listing.has_garage,
        "land_area_m2": listing.land_area_m2,
        "property_type": listing.property_type,
        "description": listing.description,
    }
    summary = analysis.finance_summary(fin, listing.price)
    content = analysis.build_analysis(
        payload, summary, listing.score.match_score if listing.score else None
    )

    db.add(
        AIInsight(
            listing_id=listing_id,
            kind="summary",
            content=content,
            model=analysis.ENGINE_NAME,
        )
    )
    db.commit()
    return AIResponse(ok=True, content=content, model=analysis.ENGINE_NAME)


@router.post("/chat", response_model=AIResponse)
def chat(req: ChatRequest, db: Session = Depends(get_db)):
    """Answer a question about the listings, grounded in the top-scoring matches."""
    rows = (
        db.query(Listing)
        .join(Score, Score.listing_id == Listing.id)
        .order_by(Score.match_score.desc())
        .limit(req.limit)
        .all()
    )
    context = []
    for r in rows:
        fin = analyse_listing(r)
        context.append(
            {
                "address": r.address,
                "suburb": r.suburb,
                "price": r.price,
                "bedrooms": r.bedrooms,
                "bathrooms": r.bathrooms,
                "has_garage": r.has_garage,
                "land_area_m2": r.land_area_m2,
                "property_type": r.property_type,
                "match_score": r.score.match_score if r.score else None,
                "rentable_rooms": fin["boarder"]["rentable_rooms"],
                "monthly_boarder_income": fin["monthly_boarder_income"],
                "net_monthly_outlay": fin["net_monthly_outlay"],
                "gross_yield_pct": fin["gross_yield_pct"],
                "payoff_years_accelerated": fin["accelerated"]["payoff_years"],
            }
        )
    return AIResponse(**analysis.answer_about_listings(req.question, context))


@router.post("/advisor", response_model=AIResponse)
def advisor(req: AdvisorRequest):
    return AIResponse(**analysis.answer_general(req.question))
